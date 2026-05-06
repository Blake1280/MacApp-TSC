import { createTRPCReact } from '@trpc/react-query';
import { ipcLink } from 'electron-trpc/renderer';
import superjson from 'superjson';
import type { AppRouter } from '../main/ipc/router';

export const trpc = createTRPCReact<AppRouter>();

export const trpcClient = trpc.createClient({
  links: [ipcLink()],
  transformer: superjson,
});
