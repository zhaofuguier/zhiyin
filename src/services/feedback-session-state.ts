export class FeedbackSessionState {
  private current = false;
  private readonly readToken: () => string | undefined;

  constructor(readToken: () => string | undefined) { this.readToken = readToken; }

  get authenticated(): boolean { return this.current; }

  refresh(): boolean {
    this.current = Boolean(this.readToken());
    return this.current;
  }
}
