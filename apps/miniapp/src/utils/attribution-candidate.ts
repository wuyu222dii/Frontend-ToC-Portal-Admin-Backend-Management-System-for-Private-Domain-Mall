let candidateToken: string | null = null;

export function setCandidateToken(token: string): void {
  if (token.length < 32 || token.length > 512) throw new Error('Candidate token is invalid');
  candidateToken = token;
}

export function peekCandidateToken(): string | null {
  return candidateToken;
}

export function clearCandidateToken(): void {
  candidateToken = null;
}
