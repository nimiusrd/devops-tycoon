import { Component, createElement, lazy, Suspense, type ComponentType } from 'react';
import { markWebglFailed } from '../render/webglStatus';
import { WebglLoading } from './WebglLoading';

export interface WebglSceneProps<P extends object> {
  load: () => Promise<{ default: ComponentType<P> }>;
  componentProps: P;
}

/** 描画チャンクの読込失敗でもゲーム本体を残す。再試行ごとにkeyで作り直す。 */
export class WebglScene<P extends object> extends Component<WebglSceneProps<P>> {
  state = { failed: false };
  private readonly Content;

  constructor(props: WebglSceneProps<P>) {
    super(props);
    // React.lazyが保持するrejectも、次の試行では新しいインスタンスへ切り替える。
    this.Content = lazy(props.load);
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.warn('WebGL scene could not be loaded or rendered', error);
    markWebglFailed();
  }

  render() {
    if (this.state.failed) return null;
    return (
      <Suspense fallback={<WebglLoading />}>
        {createElement(this.Content, this.props.componentProps)}
      </Suspense>
    );
  }
}
