import { ConfigService } from '@nestjs/config';
import { InternalServerErrorException } from '@nestjs/common';
import { EmailService } from '../email/email.service';
import { FeedbackService } from './feedback.service';

describe('FeedbackService', () => {
  const sendEmail = jest.fn();
  const get = jest.fn();
  let service: FeedbackService;

  beforeEach(() => {
    jest.clearAllMocks();
    get.mockReturnValue('feedback@example.com');
    sendEmail.mockResolvedValue({ messageId: 'message-1' });
    service = new FeedbackService(
      { get } as unknown as ConfigService,
      { sendEmail } as unknown as EmailService,
    );
  });

  it('sends escaped feedback with identity from the authenticated actor', async () => {
    await service.submitFeatureRequest(
      {
        userId: 'user-1',
        name: 'ישראל <בדיקה>',
        roles: [
          { roleId: 10000, role: 'BRANCH_ADMIN', branchName: 'סניף מרכז' },
        ],
      },
      { title: 'שיפור <חדש>', description: 'תיאור & פרטים' },
    );

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'feedback@example.com',
        subject: 'בקשת פיצ׳ר חדשה - עת לעשות',
        text: expect.stringContaining('ישראל <בדיקה>'),
        html: expect.stringContaining('ישראל &lt;בדיקה&gt;'),
      }),
    );
    expect(sendEmail.mock.calls[0][0].html).toContain('תיאור &amp; פרטים');
  });

  it('fails safely when the destination email is not configured', async () => {
    get.mockReturnValue(undefined);

    await expect(
      service.submitFeatureRequest(
        { name: 'ישראל', roles: [] },
        { title: 'כותרת', description: 'תיאור' },
      ),
    ).rejects.toEqual(
      new InternalServerErrorException('Feedback service is not configured'),
    );
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
