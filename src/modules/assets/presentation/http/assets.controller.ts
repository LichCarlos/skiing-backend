import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiOkResponse,
  ApiProperty,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ManageAssets } from '../../application/manage-assets.js';
import { MAX_ASSET_BYTES } from '../../domain/asset-rules.js';
import { RequirePermissions } from '../../../identity-access/presentation/http/authorization.decorators.js';

interface AssetRequest extends Request {
  authenticatedUserId?: number;
}

interface UploadedImage {
  buffer: Buffer;
  originalname: string;
}

class AssetVO {
  @ApiProperty({ type: String, example: '123' })
  assetId!: string;
  @ApiProperty()
  originalName!: string;
  @ApiProperty({ enum: ['image/jpeg', 'image/png', 'image/webp'] })
  mimeType!: string;
  @ApiProperty({ type: String, example: '34567' })
  sizeBytes!: string;
  @ApiProperty({ enum: ['pending_scan', 'ready', 'rejected', 'deleted'] })
  status!: string;
  @ApiProperty({ type: String, nullable: true })
  url!: string | null;
  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

@ApiTags('assets')
@Controller('assets')
export class AssetsController {
  constructor(private readonly assets: ManageAssets) {}

  @Post()
  @RequirePermissions('asset:upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_ASSET_BYTES, files: 1 },
    }),
  )
  @ApiOperation({ summary: 'Upload, scan, and store a private image asset' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiCreatedResponse({ type: AssetVO })
  @ApiBadRequestResponse({ description: 'Invalid or unsupported image file.' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required.' })
  @ApiUnprocessableEntityResponse({
    description: 'Image was rejected by malware scanning.',
  })
  async upload(
    @UploadedFile() file: UploadedImage | undefined,
    @Req() request: AssetRequest,
  ) {
    if (!file || !request.authenticatedUserId) {
      throw new BadRequestException(
        'Image file and authenticated owner are required',
      );
    }
    return this.assets.upload({
      ownerUserId: request.authenticatedUserId,
      originalName: file.originalname,
      buffer: file.buffer,
    });
  }

  @Get(':assetId')
  @RequirePermissions('asset:read-own')
  @ApiOperation({ summary: 'Read an owned asset and issue a short-lived URL' })
  @ApiOkResponse({ type: AssetVO })
  @ApiNotFoundResponse({
    description: 'Asset does not exist or is not owned by the caller.',
  })
  async get(@Param('assetId') assetId: string, @Req() request: AssetRequest) {
    if (!request.authenticatedUserId)
      throw new BadRequestException('Authentication is required');
    return this.assets.get(assetId, request.authenticatedUserId);
  }

  @Delete(':assetId')
  @RequirePermissions('asset:delete-own')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an owned asset that has no references' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({
    description: 'Asset does not exist or is not owned by the caller.',
  })
  @ApiUnprocessableEntityResponse({
    description: 'An asset referenced by content cannot be deleted.',
  })
  async remove(
    @Param('assetId') assetId: string,
    @Req() request: AssetRequest,
  ): Promise<void> {
    if (!request.authenticatedUserId)
      throw new BadRequestException('Authentication is required');
    await this.assets.remove(assetId, request.authenticatedUserId);
  }
}
