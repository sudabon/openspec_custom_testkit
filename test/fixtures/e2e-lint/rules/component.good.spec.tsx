import { expect, test } from '@playwright/experimental-ct-react';
import { Button } from '../src/Button';

test('ボタンの文言が出る', { tag: ['@demo', '@TP-001'] }, async ({ mount }) => {
  const component = await mount(
    <Button title="Don't" disabled={false}>
      Can't stop {'now'} — <strong>it's</strong> test.only
    </Button>,
  );
  await expect(component).toHaveText("Can't stop now — it's test.only");
});
