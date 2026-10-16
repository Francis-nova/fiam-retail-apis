import { SlackNotifier } from './slack-notifier.service';

describe('SlackNotifier.accountDeletionRequested', () => {
  const user = {
    id: 'u-1',
    email: 'a@b.com',
    firstName: 'Ada',
    lastName: 'Obi',
  };
  const fetchMock = jest.fn().mockResolvedValue({ ok: true });
  const realFetch = global.fetch;
  beforeEach(() => {
    fetchMock.mockClear();
    global.fetch = fetchMock as never;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  const make = (urls: Record<string, string>) =>
    new SlackNotifier({ get: (key: string) => urls[key] ?? '' } as never);
  const body = () =>
    (
      JSON.parse(
        (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
      ) as { text: string }
    ).text;

  it('posts to the KYC channel with who asked and why', () => {
    make({
      'slack.kycCompletedWebhookUrl': 'https://hooks/kyc',
      'slack.signupsWebhookUrl': 'https://hooks/signups',
    }).accountDeletionRequested(user, 'Moving abroad');
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://hooks/kyc');
    const text = body();
    expect(text).toContain('Account deletion requested');
    expect(text).toContain('*Ada Obi* · a@b.com');
    expect(text).toContain('User ID: u-1');
    expect(text).toContain('Reason: Moving abroad');
  });

  it('omits the reason line when none was given and clips a long one', () => {
    const notifier = make({
      'slack.kycCompletedWebhookUrl': 'https://hooks/kyc',
    });
    notifier.accountDeletionRequested(user, null);
    expect(body()).not.toContain('Reason:');
    fetchMock.mockClear();
    notifier.accountDeletionRequested(user, 'x'.repeat(1000));
    expect(body().length).toBeLessThan(500);
  });

  it('does nothing when the KYC webhook is not configured', () => {
    make({}).accountDeletionRequested(user, 'x');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
