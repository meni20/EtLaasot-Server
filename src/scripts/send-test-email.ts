import { NestFactory } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { EmailModule } from '../modules/email/email.module';
import { EmailService } from '../modules/email/email.service';
import { loadRuntimeEnvironment } from '../../scripts/runtime-environment.cjs';

loadRuntimeEnvironment({ rootDir: process.cwd() });

@Module({
  imports: [
    ConfigModule.forRoot({
      ignoreEnvFile: true,
      isGlobal: true,
    }),
    EmailModule,
  ],
})
class EmailTestModule {}

const run = async () => {
  const app = await NestFactory.createApplicationContext(EmailTestModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const configService = app.get(ConfigService);
    const emailService = app.get(EmailService);
    const testRecipient = configService.get<string>('SMTP_USER')?.trim();

    if (!testRecipient) {
      throw new Error('SMTP_USER is required for the test recipient');
    }

    await emailService.verifyConnection();

    const result = await emailService.sendEmail({
      to: testRecipient,
      subject: 'Et-Laasot email test',
      text: 'Email sending from the Et-Laasot server is working.',
      html: '<p>Email sending from the Et-Laasot server is working.</p>',
    });

    console.log('SMTP connection verified and test email sent.');
    console.log(`Message ID: ${result.messageId}`);
    console.log(`Accepted recipients: ${result.accepted.length}`);

    if (result.rejected.length > 0) {
      console.log(`Rejected recipients: ${result.rejected.length}`);
    }
  } finally {
    await app.close();
  }
};

run().catch((error) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`Email test failed: ${message}`);
  process.exitCode = 1;
});
