'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@/components/ui/input-otp';

import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { verifySecret, sendEmailOTP } from '@/lib/actions/user.actions';
import { useRouter } from 'next/navigation';
import { useState, MouseEvent } from 'react';

const OtpModal = ({
  email,
  accountId,
}: {
  email: string;
  accountId: string;
}) => {
  // States
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(true);
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Handle OTP code submission
  const handleSubmit = async (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      // Verify OTP
      const session = await verifySecret({
        accountId,
        password,
      });

      // sessionId is set only after the code matches. Leave the spinner up:
      // router.push returns before the dashboard has rendered, and clearing
      // the spinner here made the button look idle during that wait.
      if (session?.sessionId) {
        router.push('/');
        return;
      }

      setError(session?.error || 'Failed to verify OTP. Please try again.');
      setIsLoading(false);
    } catch {
      setError('Failed to verify OTP. Please try again.');
      setIsLoading(false);
    }
  };

  // Replaces the stored code, then says so in the dialog. Clearing the boxes
  // is the proof the previous digits are no longer the ones to submit.
  const handleOtpResend = async () => {
    setResending(true);
    setError('');
    setNotice('');

    try {
      const result = await sendEmailOTP({ email });

      if (result?.error) {
        setError(result.error);
        return;
      }

      setPassword('');
      setNotice('A new code was sent. The previous code no longer works.');
    } catch {
      setError('Could not send a new code. Try again.');
    } finally {
      setResending(false);
    }
  };

  return (
    <AlertDialog
      open={isOpen}
      onOpenChange={(next) => {
        // A correct code is navigating. Closing the dialog in that gap
        // hides the spinner and looks like the click did nothing.
        if (!next && isLoading) return;
        setIsOpen(next);
      }}
    >
      <AlertDialogContent className="shad-alert-dialog">
        <AlertDialogHeader className="relative flex justify-center">
          <AlertDialogTitle className="h2 text-center">
            Enter Your OTP
            <Image
              src="/assets/icons/close-dark.svg"
              alt="close"
              width={20}
              height={20}
              onClick={() => {
                if (!isLoading) setIsOpen(false);
              }}
              className="otp-close-button"
            />
          </AlertDialogTitle>
          <AlertDialogDescription className="subtitle-2 text-center text-light-100">
            We&apos;ve sent a code to{' '}
            <span className="pl-1 text-brand">{email}</span>
          </AlertDialogDescription>
          {notice && (
            <p className="subtitle-2 text-center text-green">{notice}</p>
          )}
          <AlertDialogDescription className="subtitle-2 text-center text-brand">
            {error}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <InputOTP maxLength={6} value={password} onChange={setPassword} disabled={isLoading}>
          <InputOTPGroup className="shad-otp">
            <InputOTPSlot index={0} className="shad-otp-slot" />
            <InputOTPSlot index={1} className="shad-otp-slot" />
            <InputOTPSlot index={2} className="shad-otp-slot" />
            <InputOTPSlot index={3} className="shad-otp-slot" />
            <InputOTPSlot index={4} className="shad-otp-slot" />
            <InputOTPSlot index={5} className="shad-otp-slot" />
          </InputOTPGroup>
        </InputOTP>

        <AlertDialogFooter>
          <div className="flex w-full flex-col gap-4">
            <AlertDialogAction
              onClick={handleSubmit}
              className="shad-submit-btn h-12"
              type="button"
              disabled={isLoading}
            >
              Submit
              {/* Show loading state after otp submission */}
              {isLoading && (
                <Image
                  src="/assets/icons/loader.svg"
                  alt="loader"
                  width={24}
                  height={24}
                  className="ml-2 animate-spin"
                />
              )}
            </AlertDialogAction>

            {/* Resend otp button */}
            <div className="subtitle-2 mt-2 text-center text-light-100">
              Didn&apos;t get a code?
              <Button
                type="button"
                variant="link"
                className="pl-1 text-brand"
                onClick={handleOtpResend}
                disabled={isLoading || resending}
              >
                {resending ? 'Sending a new code…' : 'Click to resend'}
                {resending && (
                  <Image
                    src="/assets/icons/loader.svg"
                    alt=""
                    width={16}
                    height={16}
                    className="ml-1 inline animate-spin"
                  />
                )}
              </Button>
            </div>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default OtpModal;
