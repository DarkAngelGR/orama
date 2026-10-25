// Who is signed in and which server we're talking to. Persisted so a restart
// goes straight to the home screen.
import * as store from './util/store.js';
import { Server } from './plex/server.js';
import { getServers, connect } from './plex/auth.js';
import { log } from './util/log.js';

export const session = {
  token: store.get('token'),
  user: store.get('user'),
  // The token the household's account signed in with: Plex only lets that one
  // switch between Home profiles. `token` is the profile currently watching.
  accountToken: store.get('accountToken') || store.get('token'),
  server: null,
  skipProfileOnce: false,
};

// Installs from before profiles: the signed-in token is the account holder's.
if (session.accountToken && !store.get('accountToken')) store.set('accountToken', session.accountToken);

const saved = store.get('server');
if (saved) session.server = new Server(saved);

export function signIn(token, user) {
  session.token = token;
  session.accountToken = token;
  session.user = { title: user.title || user.username, thumb: user.thumb, uuid: user.uuid };
  store.set('token', token);
  store.set('accountToken', token);
  store.set('user', session.user);
}

// A Home profile took over: its own token and server access, the account
// holder's token stays for switching back.
export function useProfile(token, user) {
  if (session.accountToken) store.set('accountToken', session.accountToken);
  session.token = token;
  session.user = { title: user.title || user.username, thumb: user.thumb, uuid: user.uuid };
  store.set('token', token);
  store.set('user', session.user);
  store.set('homeCache', undefined); // Continue Watching etc. are per profile
}

export function useServer(resource, uri) {
  session.server = new Server({ uri, token: resource.accessToken, name: resource.name, id: resource.clientIdentifier });
  store.set('server', { uri, token: resource.accessToken, name: resource.name, id: resource.clientIdentifier });
}

export function signOut() {
  session.token = null;
  session.accountToken = null;
  session.user = null;
  store.set('accountToken', undefined);
  session.server = null;
  store.set('token', undefined);
  store.set('user', undefined);
  store.set('server', undefined);
  store.set('homeCache', undefined);
}

// The saved URI can go stale (DHCP, remote vs. home). Re-resolve it from plex.tv.
export async function reconnect() {
  const servers = await getServers(session.token);
  const current = session.server && servers.find(s => s.clientIdentifier === session.server.id);
  const resource = current || servers[0];
  if (!resource) throw new Error('No Plex servers on this account');
  const uri = await connect(resource);
  useServer(resource, uri);
  log('reconnected', resource.name, uri);
  return session.server;
}
