import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenAiCompatibleChatModelProvider } from '../src/modules/ai-assistant/infrastructure/openai-compatible-chat-model.provider.js';
import { OpenAiCompatibleEmbeddingProvider } from '../src/modules/ai-assistant/infrastructure/openai-compatible-embedding.provider.js';
import {
  assertSuccessfulResponse,
  createModelRequestSignal,
  modelAuthorizationHeader,
} from '../src/modules/ai-assistant/infrastructure/openai-compatible-http.js';

export type VerificationTarget = 'chat' | 'embedding' | 'all';
type Values = Record<string, string | undefined>;
type Check = {
  provider: 'chat' | 'embedding';
  status: 'passed' | 'failed' | 'not_configured';
  code?: string;
  httpStatus?: number;
  elapsedMs: number;
  model?: string;
  streamChunks?: number;
  outputCharacters?: number;
  vectors?: number;
  dimension?: number;
  relatedSimilarity?: number;
  unrelatedSimilarity?: number;
};

class VerificationFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export function parseVerificationTarget(args: readonly string[]) {
  const options = args.filter((arg) => arg !== '--');
  if (options.length === 1 && options[0] === '--help') return 'help';
  if (options.length === 1) {
    for (const target of ['chat', 'embedding', 'all'] as const)
      if (options[0] === `--${target}`) return target;
  }
  throw new VerificationFailure('explicit_target_required');
}

function providerConfig(values: Values, provider: 'chat' | 'embedding') {
  const prefix = provider === 'chat' ? 'CHAT_MODEL' : 'EMBEDDING';
  const baseValue = values[`${prefix}_BASE_URL`]?.trim();
  const key = values[`${prefix}_API_KEY`]?.trim();
  const model =
    values[provider === 'chat' ? 'CHAT_MODEL_NAME' : 'EMBEDDING_MODEL']?.trim();
  if (!baseValue || !key || !model)
    throw new VerificationFailure('missing_configuration');
  let base: URL;
  try {
    base = new URL(baseValue);
  } catch {
    throw new VerificationFailure('invalid_configuration');
  }
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(base.hostname);
  if (
    (base.protocol !== 'https:' && !(base.protocol === 'http:' && loopback)) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !/^[a-zA-Z0-9][\w./:-]{0,199}$/.test(model)
  )
    throw new VerificationFailure('invalid_configuration');
  return { base, key, model };
}

export async function verifyModelProviders(
  target: VerificationTarget,
  values: Values,
) {
  const checks: Check[] = [];
  const config = new ConfigService(values);
  for (const provider of ['chat', 'embedding'] as const) {
    if (target !== 'all' && provider !== target) continue;
    const started = Date.now();
    try {
      const { base, key, model } = providerConfig(values, provider);
      if (provider === 'chat') {
        base.pathname = `${base.pathname.replace(/\/+$/, '')}/models`;
        const response = await fetch(base, {
          headers: {
            accept: 'application/json',
            ...modelAuthorizationHeader(key),
          },
          redirect: 'error',
          signal: createModelRequestSignal(
            '20000',
            'MODEL_LIST_TIMEOUT_MS',
            20_000,
          ),
        });
        await assertSuccessfulResponse(response);
        const payload: unknown = await response.json();
        if (!isRecord(payload) || !Array.isArray(payload.data))
          throw new VerificationFailure('invalid_model_list');
        if (
          !payload.data.some(
            (item: unknown) => isRecord(item) && item.id === model,
          )
        )
          throw new VerificationFailure('model_not_available');
        let chunks = 0,
          content = '';
        for await (const text of new OpenAiCompatibleChatModelProvider(
          config,
        ).stream({
          messages: [
            {
              role: 'user',
              content: 'Reply exactly LINJI_AI_OK and nothing else.',
            },
          ],
          maxTokens: 256,
        })) {
          content += text;
          chunks++;
          if (content.length > 4096)
            throw new VerificationFailure('unexpected_probe_output');
        }
        if (!content.includes('LINJI_AI_OK'))
          throw new VerificationFailure('unexpected_probe_output');
        checks.push({
          provider,
          status: 'passed',
          model,
          streamChunks: chunks,
          outputCharacters: content.length,
          elapsedMs: Date.now() - started,
        });
      } else {
        const vectors = await new OpenAiCompatibleEmbeddingProvider(
          config,
        ).embed([
          '滑雪初学者应该佩戴头盔吗？',
          '初学滑雪应佩戴合适的滑雪头盔，并学习安全摔倒和减速。',
          '餐厅提供牛肉面和米饭，营业时间是上午十点到晚上九点。',
        ]);
        const related = cosine(vectors[0]!, vectors[1]!);
        const unrelated = cosine(vectors[0]!, vectors[2]!);
        if (related <= unrelated)
          throw new VerificationFailure('semantic_smoke_failed');
        checks.push({
          provider,
          status: 'passed',
          model,
          vectors: vectors.length,
          dimension: vectors[0]!.length,
          relatedSimilarity: related,
          unrelatedSimilarity: unrelated,
          elapsedMs: Date.now() - started,
        });
      }
    } catch (error) {
      // Never serialize raw errors, response bodies, credentials, prompts or vectors.
      const status =
        error instanceof Error
          ? /^Model provider returned HTTP (\d{3})$/.exec(error.message)?.[1]
          : undefined;
      const code =
        error instanceof VerificationFailure
          ? error.code
          : status
            ? 'provider_http_error'
            : 'provider_request_failed';
      checks.push({
        provider,
        status: code === 'missing_configuration' ? 'not_configured' : 'failed',
        code,
        ...(status ? { httpStatus: Number(status) } : {}),
        elapsedMs: Date.now() - started,
      });
    }
  }
  return {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    scope: 'real-provider-smoke-only',
    target,
    passed: checks.every((check) => check.status === 'passed'),
    checks,
  };
}

function cosine(left: readonly number[], right: readonly number[]) {
  const length = (values: readonly number[]) => Math.hypot(...values);
  const norm = length(left) * length(right);
  if (!Number.isFinite(norm) || norm === 0)
    throw new VerificationFailure('invalid_zero_or_overflow_vector');
  return (
    left.reduce((sum, value, index) => sum + value * right[index]!, 0) / norm
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function main() {
  try {
    const target = parseVerificationTarget(process.argv.slice(2));
    if (target === 'help') {
      console.log(
        'pnpm ai:verify --chat|--embedding|--all\nCalls real model providers; uses synthetic public text and may incur charges. Loads backend .env without overriding existing environment variables. Does not connect to a database or start an application server.',
      );
      return;
    }
    if (existsSync('.env')) process.loadEnvFile('.env');
    const report = await verifyModelProviders(target, process.env);
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) process.exitCode = 1;
  } catch {
    console.error(
      'Model verification failed. Use --help and check local configuration.',
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  void main();
