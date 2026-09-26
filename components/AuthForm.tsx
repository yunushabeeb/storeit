'use client';

import { z } from 'zod';
import React, { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from './ui/input';
import Image from 'next/image';
import Link from 'next/link';
import OptModal from './OtpModal';
import { useRouter } from 'next/navigation';
import { createAccount, signInUser } from '@/lib/actions/user.actions';

const AuthForm = ({
  type,
  email = '',
  notice = '',
}: {
  type: FormType;
  email?: string;
  notice?: string;
}) => {
  const router = useRouter();
  // States
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [accountId, setAccountId] = useState<string | null>(null);

  // Define a form schema.
  const formSchema = z.object({
    // Sign-in has no name field. Making it optional there keeps one schema
    // for both screens without rejecting a sign-in that omits the name.
    fullName:
      type === 'sign-up' ? z.string().min(2).max(50) : z.string().optional(),
    email: z.string().email(),
  });

  // Define your form.
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      fullName: '',
      // A share link can carry the address so the person does not retype the
      // inbox the file was shared to. A different address would not see it.
      email,
    },
  });

  // Define a submit handler.
  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    // Reset states
    setIsLoading(true);
    setErrorMessage('');
    let leaving = false;

    try {
      // Create account or sign in user
      const user =
        type === 'sign-up'
          ? await createAccount({
              fullName: values.fullName || '',
              email: values.email,
            })
          : await signInUser({ email: values.email });

      // Sign-in found no account. Keep the spinner up while sign-up opens
      // with this address already filled in.
      if (type === 'sign-in' && user?.needsAccount) {
        leaving = true;
        router.push(
          `/sign-up?email=${encodeURIComponent(values.email)}&notice=missing`,
        );
        return;
      }

      // accountId here is the login challenge id. Its presence opens the code
      // dialog. A missing id is a rate-limit or a failed create, not a session.
      if (user?.accountId) {
        setAccountId(user.accountId);
      } else {
        setErrorMessage(user.error);
      }
    } catch (error) {
      console.error(error);
      // Set error message
      setErrorMessage('Failed to create account. Please try again.');
    } finally {
      // A redirect to sign-up is still in flight. Clearing the spinner now
      // makes the button look idle before that page appears.
      if (!leaving) setIsLoading(false);
    }
  };

  return (
    <>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="auth-form">
          <h1 className="form-title">
            {type === 'sign-in' ? 'Sign In' : 'Sign Up'}
          </h1>
          {notice && <p className="auth-notice">{notice}</p>}
          {/* Error Messages */}
          {errorMessage && <p className="error-message">{errorMessage}</p>}

          {/* Render fullname field on sign-up page */}
          {type === 'sign-up' && (
            <FormField
              control={form.control}
              name="fullName"
              render={({ field }) => (
                <FormItem>
                  <div className="shad-form-item">
                    <FormLabel className="shad-form-label">Full Name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Enter your full name"
                        className="shad-input"
                        {...field}
                      />
                    </FormControl>
                  </div>

                  <FormMessage className="shad-form-message" />
                </FormItem>
              )}
            />
          )}

          {/* Render email field on both sign-in and sign-up page */}
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <div className="shad-form-item">
                  <FormLabel className="shad-form-label">Email</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Enter your email"
                      className="shad-input"
                      {...field}
                    />
                  </FormControl>
                </div>

                <FormMessage className="shad-form-message" />
              </FormItem>
            )}
          />

          <Button
            type="submit"
            className="form-submit-button"
            disabled={isLoading}
          >
            {type === 'sign-in' ? 'Sign In' : 'Sign Up'}

            {/* Show logging indicator on form submit */}
            {isLoading && (
              <Image
                src="/assets/icons/loader.svg"
                alt="loader"
                width={24}
                height={24}
                className="ml-2 animate-spin"
              />
            )}
          </Button>

          <div className="body-2 flex justify-center">
            <p className="text-light-100">
              {type === 'sign-in'
                ? "Don't have an account?"
                : 'Already have an account?'}
            </p>
            <Link
              href={type === 'sign-in' ? '/sign-up' : '/sign-in'}
              className="ml-1 font-medium text-brand"
            >
              {type === 'sign-in' ? 'Sign Up' : 'Sign In'}
            </Link>
          </div>
        </form>
      </Form>

      {/* Show OTP modal after sending OTP */}
      {accountId && (
        <OptModal email={form.getValues('email')} accountId={accountId} />
      )}
    </>
  );
};

export default AuthForm;
