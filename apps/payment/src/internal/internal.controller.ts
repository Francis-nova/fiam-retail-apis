import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { InternalKeyGuard } from './internal-key.guard';
import { PostingsService } from './postings.service';
import { CreatePostingDto } from './postings.dto';

// Called by the admin console only; hidden from Swagger.
@ApiExcludeController()
@Controller('internal')
@UseGuards(InternalKeyGuard)
export class InternalController {
  constructor(private readonly postings: PostingsService) {}

  @Post('postings')
  @HttpCode(200)
  post(@Body() dto: CreatePostingDto) {
    return this.postings.post(dto);
  }
}
