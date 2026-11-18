import React from 'react';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Declarative permission & review-chain gate component.
 * Renders `children` when authorized, otherwise `fallback`.
 */
export default function Can({
  permission,
  target,
  reviewKind,
  applicant,
  fallback = null,
  children
}) {
  const { can, canReview } = useAuth();

  let allowed = true;
  if (reviewKind && applicant) {
    allowed = canReview(applicant, reviewKind);
  } else if (permission) {
    allowed = can(permission, target);
  }

  if (typeof children === 'function') {
    return children({ allowed });
  }

  return allowed ? children : fallback;
}
