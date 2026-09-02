import { join } from 'path';
import { Injectable } from '@nestjs/common';
import * as pug from 'pug';

const FIAM_LOGO_URL =
  'https://usefiam.com/wp-content/uploads/2024/11/Fiam-logo.png';

@Injectable()
export class TemplateRendererService {
  // nest-cli's asset-copy always places these at <outDir>/email/templates
  // (outDir is dist/apps/postoffice — see nest-cli.json) regardless of how
  // deeply the compiler nests the compiled .js beside it (this project's
  // tsconfig pulls in ../../libs, so its rootDir inference nests emitted
  // output under apps/postoffice/apps/postoffice/src/...). Resolving from
  // process.cwd() — always apis/, the same assumption this app's
  // ConfigModule envFilePath makes — sidesteps that entirely.
  private readonly templatesDir = join(
    process.cwd(),
    'dist/apps/postoffice/email/templates',
  );

  render(templateName: string, locals: Record<string, unknown>): string {
    return pug.renderFile(join(this.templatesDir, `${templateName}.pug`), {
      logoUrl: FIAM_LOGO_URL,
      year: new Date().getFullYear(),
      ...locals,
      // Compiled functions are cached by filename — the file is only read
      // and compiled once per process, not on every send.
      cache: true,
    });
  }
}
