import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { UsersService } from '../users/users.service';
import { InternalKeyGuard } from './internal-key.guard';

// Consumed by other Fiam services (e.g. payment, to address a transaction
// email). Not part of the public API, so it's hidden from Swagger.
@ApiExcludeController()
@Controller('internal')
@UseGuards(InternalKeyGuard)
export class InternalController {
  constructor(private readonly usersService: UsersService) {}

  @Get('users/:id/contact')
  async contact(@Param('id', new ParseUUIDPipe()) id: string) {
    const user = await this.usersService.findById(id);
    return { email: user.email, firstName: user.firstName };
  }
}
