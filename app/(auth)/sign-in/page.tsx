// The form type selects sign-in behavior: email only, no full name.
// email comes from a share link so an existing account opens on the right inbox.
import AuthForm from '@/components/AuthForm';

const SignIn = async ({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) => {
  const email = (await searchParams).email || '';

  return <AuthForm type="sign-in" email={email} />;
};

export default SignIn;
