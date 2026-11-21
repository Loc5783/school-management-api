import { Navigate } from 'react-router-dom';

/**
 * Public registration is disabled.
 * Redirects immediately to /login.
 */
export default function Register() {
  return <Navigate to="/login" replace />;
}
