import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PromptEditor } from './PromptEditor';

afterEach(cleanup);

describe('PromptEditor', () => {
  it('占位文字随 props 更新（切换界面语言时）', () => {
    const { container, rerender } = render(<PromptEditor value="" onChange={() => undefined} refs={[]} placeholder="描述你想要的画面" />);
    expect(container.querySelector('.cm-placeholder')?.textContent).toBe('描述你想要的画面');
    rerender(<PromptEditor value="" onChange={() => undefined} refs={[]} placeholder="Describe the result" />);
    expect(container.querySelector('.cm-placeholder')?.textContent).toBe('Describe the result');
  });
});
