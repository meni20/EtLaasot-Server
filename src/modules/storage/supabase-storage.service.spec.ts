import { createClient } from '@supabase/supabase-js';
import { Logger } from '@nestjs/common';
import { SupabaseStorageService } from './supabase-storage.service';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));

describe('Event image Storage', () => {
  const upload = jest.fn();
  const remove = jest.fn();
  const from = jest.fn();
  let previous: NodeJS.ProcessEnv;
  let service: SupabaseStorageService;

  beforeEach(() => {
    jest.resetAllMocks();
    previous = { ...process.env };
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'server-secret';
    process.env.SUPABASE_EVENT_IMAGES_BUCKET = 'event-images';
    upload.mockResolvedValue({ error: null });
    remove.mockResolvedValue({ error: null });
    from.mockReturnValue({ upload, remove });
    (createClient as jest.Mock).mockReturnValue({ storage: { from } });
    service = new SupabaseStorageService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = previous;
  });

  it('provides a Node WebSocket transport and uploads without upsert', async () => {
    await service.uploadEventImage('event-id', {
      buffer: Buffer.from('image'),
      mimetype: 'image/png',
      originalname: 'event.png',
    } as Express.Multer.File);

    expect(createClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'server-secret',
      expect.objectContaining({
        auth: { persistSession: false, autoRefreshToken: false },
        realtime: { transport: expect.any(Function) },
      }),
    );
    expect(from).toHaveBeenCalledWith('event-images');
    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(/^events\/event-id\/[0-9a-f-]+\.png$/),
      expect.any(Buffer),
      { contentType: 'image/png', upsert: false },
    );
  });

  it('removes only the requested stored image', async () => {
    await service.deleteEventImage('events/event-id/old.png');

    expect(remove).toHaveBeenCalledWith(['events/event-id/old.png']);
  });

  it('reports upload failure without logging provider payloads or credentials', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    upload.mockResolvedValue({
      error: {
        name: 'https://private.example/server-secret',
        statusCode: 'server-secret',
        code: 'server-secret',
        message: 'server-secret',
      },
    });
    await expect(
      service.uploadEventImage('event-id', {
        buffer: Buffer.from('image'),
        mimetype: 'image/png',
        originalname: 'event.png',
      } as Express.Multer.File),
    ).rejects.toThrow('Failed to upload event image');
    expect(log).toHaveBeenCalledWith(
      'Event image storage failure: stage=event-image-upload category=UnknownError status=none',
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('server-secret');
    expect(JSON.stringify(log.mock.calls)).not.toContain('private.example');
    expect(remove).not.toHaveBeenCalled();
  });
});
