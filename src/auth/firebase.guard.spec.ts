import { AuthGuard } from './firebase.guard';

describe('AuthGuard', () => {
  it('should be defined', () => {
    expect(new AuthGuard()).toBeDefined();
  });
});
