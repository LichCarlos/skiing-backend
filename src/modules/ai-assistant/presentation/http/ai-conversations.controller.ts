import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  ForbiddenException,
  HttpException,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiProperty,
  ApiTags,
  ApiTooManyRequestsResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  diagnosticTraceId,
  failureDiagnostic,
} from '../../../../shared/diagnostics/failure-diagnostic.js';
import { AiStreamAccessRejectedError } from '../../application/ports/ai-stream-authorization.js';
import { RagEvidenceChangedError } from '../../application/ports/rag-evidence-validator.js';
import type { AuthorizationPrincipal } from '../../../identity-access/domain/authorization.js';
import { AI_CONVERSATION_USE_PERMISSION } from '../../../identity-access/domain/permissions.js';
import { RequirePermissions } from '../../../identity-access/presentation/http/authorization.decorators.js';
import {
  AiConversationNotFoundError,
  AiConversationService,
  AiMessageInProgressError,
  AiMessageRateLimitError,
  AiMessageRequestConflictError,
} from '../../application/ai-conversation.service.js';
import {
  AiConversationPageInvalidError,
  AiMessageContentInvalidError,
} from '../../domain/ai-message-rules.js';
import {
  AiConversationListQueryDto,
  CreateAiConversationDto,
  SendAiMessageDto,
} from './ai-conversation.dto.js';

interface AiAuthenticatedRequest extends Request {
  authenticatedUserId?: number;
  authenticatedSessionId?: string;
  user?: AuthorizationPrincipal | null;
  traceId?: string;
}

export class AiConversationSummaryVO {
  @ApiProperty({ format: 'uuid' })
  conversationId!: string;

  @ApiProperty({ type: String, nullable: true })
  title!: string | null;

  @ApiProperty({ enum: ['active', 'archived'] })
  status!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  @ApiProperty()
  messageCount!: number;
}

export class AiCitationVO {
  @ApiProperty({
    enum: ['resort', 'article', 'project', 'dynamic', 'dictionary'],
  })
  sourceType!: string;
  @ApiProperty() sourceId!: string;
  @ApiProperty() title!: string;
  @ApiProperty() excerpt!: string;
  @ApiProperty({ type: String, nullable: true }) href!: string | null;
}

export class AiMessageVO {
  @ApiProperty()
  messageId!: string;

  @ApiProperty({ enum: ['user', 'assistant'] })
  role!: 'user' | 'assistant';

  @ApiProperty({ enum: ['complete'] })
  status!: 'complete';

  @ApiProperty()
  content!: string;

  @ApiProperty({ type: () => AiCitationVO, isArray: true })
  citations!: unknown;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

class AiDeltaVO {
  @ApiProperty() text!: string;
}

class AiStreamErrorVO {
  @ApiProperty({ example: 'AI_GENERATION_FAILED' }) code!: string;
  @ApiProperty() msg!: string;
  @ApiProperty({ type: String, nullable: true }) traceId!: string | null;
}

export class AiStreamEventVO {
  @ApiProperty({ enum: ['delta', 'completed', 'error'] }) event!: string;
  @ApiProperty({
    oneOf: [
      { $ref: getSchemaPath(AiDeltaVO) },
      { $ref: getSchemaPath(AiMessageVO) },
      { $ref: getSchemaPath(AiStreamErrorVO) },
    ],
  })
  data!: unknown;
}

export class AiConversationDetailVO extends AiConversationSummaryVO {
  @ApiProperty({ type: () => AiMessageVO, isArray: true })
  messages!: AiMessageVO[];
}

export class AiConversationPageVO {
  @ApiProperty({ type: () => AiConversationSummaryVO, isArray: true })
  items!: AiConversationSummaryVO[];

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;
}

@ApiTags('ai-assistant')
@ApiExtraModels(AiMessageVO, AiDeltaVO, AiStreamErrorVO, AiStreamEventVO)
@Controller('ai/conversations')
@RequirePermissions(AI_CONVERSATION_USE_PERMISSION)
export class AiConversationsController {
  private readonly logger = new Logger(AiConversationsController.name);
  constructor(private readonly conversations: AiConversationService) {}

  @Get()
  @ApiOperation({ summary: 'List the current user AI conversations' })
  @ApiOkResponse({ type: AiConversationPageVO })
  async list(
    @Query() query: AiConversationListQueryDto,
    @Req() request: AiAuthenticatedRequest,
  ) {
    try {
      return await this.conversations.list(
        this.userId(request),
        query.page,
        query.pageSize,
      );
    } catch (error) {
      throw mapAiConversationError(error);
    }
  }

  @Post()
  @ApiOperation({ summary: 'Create an AI conversation' })
  @ApiBody({ type: CreateAiConversationDto })
  @ApiCreatedResponse({ type: AiConversationSummaryVO })
  create(
    @Body() _body: CreateAiConversationDto,
    @Req() request: AiAuthenticatedRequest,
  ) {
    return this.conversations.create(this.userId(request));
  }

  @Get(':conversationId')
  @ApiOperation({ summary: 'Read an owned AI conversation and its messages' })
  @ApiOkResponse({ type: AiConversationDetailVO })
  @ApiNotFoundResponse()
  async detail(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Req() request: AiAuthenticatedRequest,
  ) {
    try {
      return await this.conversations.detail(
        this.userId(request),
        conversationId,
      );
    } catch (error) {
      throw mapAiConversationError(error);
    }
  }

  @Delete(':conversationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete an owned AI conversation' })
  @ApiNoContentResponse()
  async remove(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Req() request: AiAuthenticatedRequest,
  ): Promise<void> {
    try {
      await this.conversations.remove(this.userId(request), conversationId);
    } catch (error) {
      throw mapAiConversationError(error);
    }
  }

  @Post(':conversationId/messages')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ask the ski assistant using an SSE response' })
  @ApiBody({ type: SendAiMessageDto })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({
    description:
      'SSE: event delta with JSON {text}; event completed with AiMessageVO. A post-header failure sends event error with a redacted code/msg/traceId. No JSON envelope wraps SSE.',
    content: {
      'text/event-stream': {
        schema: { type: 'string' },
        example:
          'event: delta\ndata: {"text":"滑雪"}\n\nevent: completed\ndata: {"messageId":"2","role":"assistant","status":"complete","content":"滑雪","citations":[],"createdAt":"2026-10-29T00:00:00.000Z"}\n\n',
      },
    },
  })
  @ApiConflictResponse({
    description: 'Idempotency key conflict or request in progress',
  })
  @ApiTooManyRequestsResponse({
    description: 'Five new messages per rolling minute',
  })
  async sendMessage(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() body: SendAiMessageDto,
    @Req() request: AiAuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    const userId = this.userId(request);
    const principal = request.user;
    if (!principal || principal.userId !== userId) {
      throw new UnauthorizedException();
    }
    const sessionId = request.authenticatedSessionId;
    if (!sessionId) throw new UnauthorizedException();
    const abort = new AbortController();
    const onClose = () => {
      if (!response.writableEnded) abort.abort();
    };
    response.on('close', onClose);

    const iterator = this.conversations
      .sendMessage({
        userId,
        sessionId,
        principal,
        conversationId,
        clientRequestId: body.clientRequestId,
        content: body.content,
        signal: abort.signal,
      })
      [Symbol.asyncIterator]();

    try {
      let next = await iterator.next();
      abort.signal.throwIfAborted();
      response.status(HttpStatus.OK);
      response.set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      response.flushHeaders();
      while (!next.done) {
        abort.signal.throwIfAborted();
        if (!response.write(serializeSseEvent(next.value))) {
          await waitForDrain(response, abort.signal);
        }
        next = await iterator.next();
      }
      response.end();
    } catch (error) {
      if (response.destroyed || abort.signal.aborted) return;
      if (response.headersSent) {
        this.logger.error({
          event: 'ai_message_stream_failed',
          traceId: diagnosticTraceId(request.traceId),
          failure: failureDiagnostic(error),
        });
        response.write(
          `event: error\ndata: ${JSON.stringify({ code: 'AI_GENERATION_FAILED', msg: 'AI 回答生成失败', traceId: request.traceId ?? null })}\n\n`,
        );
        response.end();
        return;
      }
      throw mapAiConversationError(error);
    } finally {
      abort.abort();
      response.off('close', onClose);
      await iterator.return(undefined);
    }
  }

  private userId(request: AiAuthenticatedRequest): number {
    if (!request.authenticatedUserId) throw new UnauthorizedException();
    return request.authenticatedUserId;
  }
}

function waitForDrain(response: Response, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      response.off('drain', drained);
      signal.removeEventListener('abort', aborted);
    };
    const drained = () => {
      cleanup();
      resolve();
    };
    const aborted = () => {
      cleanup();
      reject(new Error('Response closed'));
    };
    response.once('drain', drained);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

export function serializeSseEvent(event: {
  event: 'delta' | 'completed';
  data: unknown;
}): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

function mapAiConversationError(error: unknown): Error {
  if (error instanceof RagEvidenceChangedError) {
    return new ConflictException(
      'AI reference data changed; retry the original request',
    );
  }
  if (error instanceof AiStreamAccessRejectedError) {
    return error.reason === 'session'
      ? new UnauthorizedException('AI stream access is no longer available')
      : new ForbiddenException('AI stream access is no longer available');
  }
  if (error instanceof AiConversationNotFoundError)
    return new NotFoundException('Conversation not found');
  if (error instanceof AiMessageRateLimitError)
    return new HttpException(
      'AI message rate limit exceeded',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  if (
    error instanceof AiMessageContentInvalidError ||
    error instanceof AiConversationPageInvalidError
  )
    return new BadRequestException(error.message);
  if (
    error instanceof AiMessageRequestConflictError ||
    error instanceof AiMessageInProgressError
  ) {
    return new ConflictException(error.message);
  }
  return error instanceof Error ? error : new Error('AI request failed');
}
