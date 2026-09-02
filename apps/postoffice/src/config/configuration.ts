export interface PostofficeConfig {
  env: string;
  port: number;
  rabbitmq: {
    url: string;
  };
  sms: {
    provider: string;
    termii: {
      apiKey: string;
      senderId: string;
      baseUrl: string;
    };
  };
}

export default (): PostofficeConfig => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.POSTOFFICE_PORT ?? '7002', 10),
  rabbitmq: {
    url: process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672',
  },
  sms: {
    provider: process.env.SMS_PROVIDER ?? 'termii',
    termii: {
      apiKey: process.env.TERMII_API_KEY ?? '',
      senderId: process.env.TERMII_SENDER_ID ?? '',
      baseUrl: process.env.TERMII_BASE_URL ?? 'https://api.ng.termii.com',
    },
  },
});
