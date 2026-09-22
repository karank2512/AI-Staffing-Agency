/** State threaded through `useActionState` for the sign-in form. Plain JSON only. */
export interface SignInState {
  error: string | null;
}

export const SIGN_IN_MESSAGES = {
  missingFields: "Enter your email and password.",
  invalidCredentials: "Invalid email or password",
  unexpected: "We couldn't sign you in right now. Please try again.",
} as const;
