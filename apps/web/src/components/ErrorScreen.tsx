// Crash screens: `RouteError` (the router's defaultErrorComponent, a page crashed) and `Boundary` (root of the app:
// dialogs, undo bar, the router itself). Translated, nothing technical but an ApiError's own (translated) message.
import { useNavigate, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { TriangleAlert } from 'lucide-react';
import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { ApiError } from '../api';
import { t } from '../i18n';
import { Empty } from './Panes';
import { Button } from './ui';

export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const navigate = useNavigate();
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div data-error-screen="page">
      <Empty
        icon={<TriangleAlert strokeWidth={1.5} />}
        title={t('Cette page a rencontré une erreur')}
        actions={(
          <>
            <Button type="button" variant="primary" onClick={() => { reset(); void router.invalidate(); }}>{t('Réessayer')}</Button>
            <Button type="button" onClick={() => window.location.reload()}>{t('Recharger la page')}</Button>
            <Button type="button" variant="ghost" onClick={() => { reset(); void navigate({ to: '/' }); }}>{t('Aller aux sessions')}</Button>
          </>
        )}
      >
        {error instanceof ApiError ? error.message : undefined}
      </Empty>
    </div>
  );
}

/** Root boundary: a crash outside the pages replaces the app by this screen (better than a frozen app). */
export class Boundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) { return { error: error ?? new Error('unknown') }; }

  componentDidCatch(error: unknown, info: ErrorInfo) { console.error(error, info.componentStack); }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div data-error-screen="app" className="flex min-h-full items-center justify-center bg-sheet">
        <Empty
          icon={<TriangleAlert strokeWidth={1.5} />}
          title={t('Intendia a rencontré une erreur')}
          actions={<Button type="button" variant="primary" onClick={() => window.location.reload()}>{t('Recharger la page')}</Button>}
        />
      </div>
    );
  }
}
