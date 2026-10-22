import React from "react";

import { StudioRevisionContext } from "utils/contexts/studio-revision";

export default class ErrorBoundary extends React.Component {
  static contextType = StudioRevisionContext;

  constructor(props) {
    super(props);
    this.state = { error: null, errorInfo: null };
  }

  // Studio: retry only a failed subtree after native configuration changes.
  componentDidMount() {
    this.studioRevision = this.context;
  }

  componentDidUpdate() {
    const changed = this.studioRevision !== this.context;
    this.studioRevision = this.context;
    if (changed && this.state.errorInfo) this.setState({ error: null, errorInfo: null });
  }

  componentDidCatch(error, errorInfo) {
    // Catch errors in any components below and re-render with error message
    this.setState({
      error,
      errorInfo,
    });

    // You can also log error messages to an error reporting service here
    if (error || errorInfo) {
      console.error("component error: %s, info: %s", error, errorInfo);
    }
  }

  render() {
    const { error, errorInfo } = this.state;
    if (errorInfo) {
      // Error path
      return (
        <div className="inline-block text-sm bg-rose-100 text-rose-900 dark:bg-rose-900 dark:text-rose-100 rounded-md p-2 m-1">
          <div className="font-medium mb-1">Something went wrong.</div>
          <details className="text-xs font-mono whitespace-pre">
            <summary>{error && error.toString()}</summary>
            {errorInfo.componentStack}
          </details>
        </div>
      );
    }

    // Normally, just render children
    const { children } = this.props;
    return children;
  }
}
