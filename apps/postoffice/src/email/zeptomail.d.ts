// zeptomail@8.0.1 ships .d.ts files with extension-less relative imports
// (e.g. `./sendmail/sendMail`), which don't resolve under this project's
// "nodenext" moduleResolution — every such import silently collapses to
// `any` instead of erroring, which then trips @typescript-eslint's
// no-unsafe-* rules wherever the SDK is used. This ambient declaration
// covers only the "send mail" call this app actually makes; if more of the
// SDK is used later (templates, batch sends, agent/domain management),
// extend it here rather than relying on the package's own broken types.
declare module 'zeptomail' {
  interface ZeptomailClientParams {
    url: string;
    token: string;
    debug?: boolean;
    domain?: string;
  }

  interface ZeptomailEmailAddress {
    address: string;
    name: string;
  }

  interface ZeptomailSendMailParams {
    from: ZeptomailEmailAddress;
    to: Array<{ email_address: ZeptomailEmailAddress }>;
    subject: string;
    htmlbody?: string;
    textbody?: string;
    cc?: Array<{ email_address: ZeptomailEmailAddress }>;
    bcc?: Array<{ email_address: ZeptomailEmailAddress }>;
    track_clicks?: boolean;
    track_opens?: boolean;
    client_reference?: string;
  }

  export class SendMailClient {
    constructor(params: ZeptomailClientParams);
    sendMail(options: ZeptomailSendMailParams): Promise<unknown>;
  }
}
