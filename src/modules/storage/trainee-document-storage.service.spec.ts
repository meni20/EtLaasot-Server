import { createClient } from '@supabase/supabase-js';
import { TraineeDocumentStorageService } from './trainee-document-storage.service';
import { DocumentType } from '../trainee-document/trainee-document.constants';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));

describe('Private document Storage', () => {
  const getBucket = jest.fn();
  const upload = jest.fn();
  const remove = jest.fn();
  const createSignedUrl = jest.fn();
  const from = jest.fn();
  let service: TraineeDocumentStorageService;
  let previous: NodeJS.ProcessEnv;
  let path: string;

  beforeEach(() => {
    jest.resetAllMocks();
    previous = { ...process.env };
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'server-secret';
    process.env.SUPABASE_TRAINEE_DOCUMENTS_BUCKET = 'trainee-documents';
    getBucket.mockResolvedValue({ data: { public: false }, error: null });
    upload.mockResolvedValue({ error: null });
    remove.mockResolvedValue({ error: null });
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://example/signed' },
      error: null,
    });
    from.mockReturnValue({ upload, remove, createSignedUrl });
    (createClient as jest.Mock).mockReturnValue({
      storage: { getBucket, from },
    });
    service = new TraineeDocumentStorageService();
    path = service.buildPath(
      '11111111-1111-4111-8111-111111111111',
      DocumentType.MAGNETIC_CARD,
      'pdf',
    );
  });
  afterEach(() => {
    process.env = previous;
    jest.restoreAllMocks();
  });

  it('uses random server paths and private non-upserting uploads', async () => {
    expect(path).toMatch(
      /^11111111-1111-4111-8111-111111111111\/MAGNETIC_CARD\/[0-9a-f-]{36}\.pdf$/,
    );
    expect(
      service.buildPath(
        '11111111-1111-4111-8111-111111111111',
        DocumentType.MAGNETIC_CARD,
        'pdf',
      ),
    ).not.toBe(path);
    await service.upload(path, Buffer.from('file'), 'application/pdf');
    expect(getBucket).toHaveBeenCalledWith('trainee-documents');
    expect(from).toHaveBeenCalledWith('trainee-documents');
    expect(upload).toHaveBeenCalledWith(path, expect.any(Buffer), {
      contentType: 'application/pdf',
      upsert: false,
      cacheControl: '0',
    });
    expect(createClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'server-secret',
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  });

  it('creates a 60-second signed URL and removes only the selected path', async () => {
    const start = Date.now();
    const view = await service.sign(path);
    expect(createSignedUrl).toHaveBeenCalledWith(path, 60);
    expect(Date.parse(view.expiresAt)).toBeGreaterThanOrEqual(start + 60000);
    expect(Date.parse(view.expiresAt)).toBeLessThanOrEqual(Date.now() + 60000);
    await service.remove(path);
    expect(remove).toHaveBeenCalledWith([path]);
  });

  it.each(['public', 'missing', 'unconfigured'])(
    'fails closed for %s bucket',
    async (state) => {
      if (state === 'public')
        getBucket.mockResolvedValue({ data: { public: true } });
      if (state === 'missing')
        getBucket.mockResolvedValue({ error: new Error('provider secret') });
      if (state === 'unconfigured')
        delete process.env.SUPABASE_TRAINEE_DOCUMENTS_BUCKET;
      await expect(
        service.upload(path, Buffer.from('file'), 'application/pdf'),
      ).rejects.toThrow('Failed to upload document');
      await expect(service.sign(path)).rejects.toThrow(
        'Failed to open document',
      );
      expect(upload).not.toHaveBeenCalled();
      expect(createSignedUrl).not.toHaveBeenCalled();
    },
  );

  it('rejects traversal or malformed stored paths before contacting Storage', async () => {
    await expect(service.remove('../event-images/secret')).rejects.toThrow(
      'Invalid document storage key',
    );
    await expect(service.sign('https://example/file')).rejects.toThrow(
      'Invalid document storage key',
    );
    expect(from).not.toHaveBeenCalled();
  });

  it('sanitizes provider failures', async () => {
    upload.mockResolvedValue({ error: new Error('credential SECRET') });
    remove.mockRejectedValue(new Error('credential SECRET'));
    createSignedUrl.mockResolvedValue({
      error: new Error('credential SECRET'),
    });
    await expect(
      service.upload(path, Buffer.from('file'), 'application/pdf'),
    ).rejects.toThrow('Failed to upload document');
    await expect(service.remove(path)).rejects.toThrow(
      'Failed to remove document',
    );
    await expect(service.sign(path)).rejects.toThrow('Failed to open document');
  });
});
