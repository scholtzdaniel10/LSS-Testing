import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import App from './App';

const TOKEN_KEY = 'lss.apiToken';

type FetchCall = { path: string; init?: RequestInit };
const calls: FetchCall[] = [];

const envelope = (data: unknown, errors: unknown[] = []) => ({ data, meta: {}, errors });

function jsonResponse(status: number, body: unknown | null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 401 ? 'Unauthorized' : '',
    json: async () => {
      if (body === null) throw new Error('no body');
      return body;
    },
  } as unknown as Response;
}

/** Minimal /api/v1 stub: login succeeds for the seeded user, everything else is empty. */
function stubFetch(opts: { loginStatus?: number } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    calls.push({ path, init });
    if (path.endsWith('/api/v1/auth/login')) {
      if (opts.loginStatus === 401) {
        return jsonResponse(
          401,
          envelope(null, [
            { title: 'Invalid credentials', detail: 'The email or password is incorrect.', status: 401 },
          ]),
        );
      }
      return jsonResponse(
        200,
        envelope({ token: 'pat-123', user: { id: 1, name: 'Daniel', email: 'daniel@lss.local' } }),
      );
    }
    if (path.endsWith('/api/v1/auth/logout')) return jsonResponse(204, null);
    return jsonResponse(200, envelope([]));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  localStorage.clear();
  calls.length = 0;
  window.history.replaceState({}, '', '/');
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('renders the shell with navigation and the health landing page when a token is present', async () => {
  localStorage.setItem(TOKEN_KEY, 'seeded-token');
  render(<App />);
  expect(screen.getByRole('link', { name: 'Health' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Explore' })).toBeInTheDocument();
  expect(screen.getByText('Program health')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
});

test('redirects to /login and hides the shell when no token is stored', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  expect(screen.getByLabelText('Email')).toBeInTheDocument();
  expect(screen.getByLabelText('Password')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Health' })).not.toBeInTheDocument();
  expect(window.location.pathname).toBe('/login');
});

test('signing in stores the token and lands on the app', async () => {
  render(<App />);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'daniel@lss.local' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

  await screen.findByText('Program health');
  expect(localStorage.getItem(TOKEN_KEY)).toBe('pat-123');
  expect(screen.getByRole('link', { name: 'Health' })).toBeInTheDocument();

  const login = calls.find((c) => c.path.endsWith('/api/v1/auth/login'));
  expect(login?.init?.method).toBe('POST');
  expect(JSON.parse(String(login?.init?.body))).toEqual({ email: 'daniel@lss.local', password: 'password' });
});

test('wrong credentials show the API error inline and keep the user on /login', async () => {
  stubFetch({ loginStatus: 401 });
  render(<App />);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'daniel@lss.local' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'nope' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('The email or password is incorrect.');
  expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  expect(window.location.pathname).toBe('/login');
});

test('visiting /login with a token already stored redirects into the app', async () => {
  localStorage.setItem(TOKEN_KEY, 'seeded-token');
  window.history.replaceState({}, '', '/login');
  render(<App />);
  await waitFor(() => expect(screen.getByRole('link', { name: 'Health' })).toBeInTheDocument());
  expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
});
