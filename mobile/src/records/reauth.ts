// Actions a server step guards with a recent sign-in (403 `reauth_required`, spec §5.2 step 6): the
// app asks the person to sign in again in the browser sheet (confirmIdentity, prompt=login) and then
// tries once more. Owner: APP-WORK.
import { ApiError, confirmIdentity } from '../api/client';

type Confirm = () => Promise<boolean>;

export class ReauthCanceled extends Error {
  constructor() {
    super('Sign in again to continue. Nothing was changed.');
    this.name = 'ReauthCanceled';
  }
}

/** Runs `action`; when the server asks for a recent sign-in, confirms and runs it once more. */
export async function withReauth<T>(action: () => Promise<T>, confirm: Confirm = confirmIdentity): Promise<T> {
  try {
    return await action();
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 403 || err.code !== 'reauth_required') throw err;
    if (!(await confirm())) throw new ReauthCanceled();
    return action();
  }
}
