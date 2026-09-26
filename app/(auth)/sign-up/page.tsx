// The form type asks for a full name and treats an existing email as a sign-in.
// email comes from a share link, or from sign-in when the address has no account.
import AuthForm from '@/components/AuthForm';
import React from 'react';

const SignUp = async ({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; notice?: string }>;
}) => {
  const params = await searchParams;
  const email = params.email || '';
  // Sign-in landed here because this address has no account. The sentence
  // tells them why, and the email field is already filled with what they typed.
  const notice =
    params.notice === 'missing'
      ? 'There is no StoreIt account for this email yet. Add your name and we will send you a code.'
      : '';

  return <AuthForm type="sign-up" email={email} notice={notice} />;
};

export default SignUp;
