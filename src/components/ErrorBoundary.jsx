import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[Rāma] ErrorBoundary caught:', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div style={{
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        justifyContent: 'center',
        height:         '100%',
        gap:            '16px',
        background:     'var(--bg)',
        padding:        '32px',
        textAlign:      'center',
      }}>
        <div style={{ fontSize: '32px' }}>⚠</div>
        <div style={{ color: 'var(--red)', fontSize: '14px', fontWeight: 700 }}>
          MODULE CRITICAL FAILURE
        </div>
        <div style={{
          color:      'var(--text-dim)',
          fontSize:   '12px',
          maxWidth:   '480px',
          lineHeight: '1.7',
          background: 'var(--elevated)',
          border:     '1px solid var(--border)',
          borderRadius: '4px',
          padding:    '12px 16px',
          textAlign:  'left',
        }}>
          {this.state.error?.message || 'Unknown error'}
        </div>
        <button
          className="btn btn-primary"
          onClick={() => this.setState({ hasError: false, error: null })}
        >
          ↺ Retry
        </button>
      </div>
    );
  }
}
