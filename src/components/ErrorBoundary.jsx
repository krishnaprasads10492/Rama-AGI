import React from 'react';

/**
 * ErrorBoundary — contains a render failure without taking the app with it.
 *
 * TWO THINGS THIS FIXES (spec section 33):
 *
 * 1. SCOPE. This used to wrap AppShell, so a single page throwing replaced the
 *    titlebar and the tab strip along with the page. Navigation vanished, and the
 *    only visible thing was "MODULE CRITICAL FAILURE" — which reads as the whole
 *    app being dead rather than one module. It is now placed around the routed
 *    content only, so the shell survives and the user can navigate away.
 *
 * 2. RECOVERY. A boundary latches `hasError` forever. Navigating to a working
 *    page kept showing the error, because nothing reset the state. `resetKey`
 *    (the current route) clears it on navigation.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, info: null, showStack: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    console.error('[Rāma] ErrorBoundary caught:', error, info?.componentStack);

    // Record it so the failure is measurable, not just visible once
    try {
      window.rama?.meta?.record({
        action: 'render-error',
        ok:     false,
        tool:   this.props.label ?? 'renderer',
        error:  `${error?.message ?? error}`,
      });
    } catch { /* meta is optional */ }
  }

  componentDidUpdate(prevProps) {
    // Navigating away from a broken page must clear the error
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null, info: null, showStack: false });
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const { error, info, showStack } = this.state;

    return (
      <div style={{
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        justifyContent: 'center',
        height:         '100%',
        gap:            '14px',
        background:     'var(--bg)',
        padding:        '32px',
        textAlign:      'center',
        overflowY:      'auto',
      }}>
        <div style={{ fontSize: '30px' }}>⚠</div>

        <div style={{ color: 'var(--red)', fontSize: '14px', fontWeight: 700, letterSpacing: '0.08em' }}>
          {this.props.label ? `${this.props.label.toUpperCase()} FAILED` : 'MODULE FAILED'}
        </div>

        <div style={{ color: 'var(--muted)', fontSize: '11px', maxWidth: '460px', lineHeight: 1.7 }}>
          This module stopped rendering. The rest of Rāma is unaffected — use the
          navigation bar to switch pages, or retry below.
        </div>

        <div style={{
          color:        'var(--text-dim)',
          fontSize:     '12px',
          maxWidth:     '560px',
          lineHeight:   '1.7',
          background:   'var(--elevated)',
          border:       '1px solid var(--border)',
          borderRadius: '4px',
          padding:      '12px 16px',
          textAlign:    'left',
          fontFamily:   'monospace',
          wordBreak:    'break-word',
        }}>
          {error?.message || String(error) || 'Unknown error'}
        </div>

        {info?.componentStack && (
          <>
            <button
              className="btn btn-sm"
              onClick={() => this.setState(s => ({ showStack: !s.showStack }))}
              style={{ fontSize: '10px' }}
            >
              {showStack ? 'Hide' : 'Show'} component stack
            </button>

            {showStack && (
              <pre style={{
                maxWidth: '640px', maxHeight: '240px', overflow: 'auto',
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: '4px', padding: '10px', fontSize: '10px',
                color: 'var(--muted)', textAlign: 'left', margin: 0,
              }}>
                {info.componentStack.trim()}
              </pre>
            )}
          </>
        )}

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => this.setState({ hasError: false, error: null, info: null, showStack: false })}
          >
            ↺ Retry
          </button>
          <button className="btn btn-sm" onClick={() => window.location.reload()}>
            Reload Rāma
          </button>
        </div>
      </div>
    );
  }
}
