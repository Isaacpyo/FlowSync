import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { ApiError, warmUp } from './lib/api';
import { AuthProvider } from './lib/auth';
import './index.css';

// Start waking a sleeping API right away, while the page renders.
warmUp();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      // apiRequest already retries while the server wakes up; don't retry 4xx.
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 1,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
