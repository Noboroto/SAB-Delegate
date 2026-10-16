'use client';

import { useRef, useState } from 'react';
import { Alert, App, Button } from 'antd';
import { signInWithDiscord } from '@/lib/auth/auth-client';

interface ReauthAlertProps {
  /** Where the person lands after signing in again. */
  returnPath: string;
  /** Already translated by the caller, so each screen keeps its own wording. */
  texts: { title: string; body: string; action: string; failed: string };
}

/** A change that needs a login from the last few minutes: offers the sign-in and returns to `returnPath`. */
export function ReauthAlert({ returnPath, texts }: ReauthAlertProps) {
  const { message } = App.useApp();
  const [signingIn, setSigningIn] = useState(false);
  // The ref flips at once; state would let two clicks in one frame both start a sign-in.
  const started = useRef(false);

  const signInAgain = () => {
    if (started.current) return;
    started.current = true;
    setSigningIn(true);
    signInWithDiscord(returnPath).catch((error: unknown) => {
      console.error(error);
      started.current = false;
      setSigningIn(false);
      void message.error(texts.failed);
    });
  };

  return (
    <Alert
      type="warning"
      showIcon
      title={texts.title}
      description={texts.body}
      action={
        <Button loading={signingIn} onClick={signInAgain}>
          {texts.action}
        </Button>
      }
    />
  );
}
