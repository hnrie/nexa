/**
 * The public half of the key releases are signed with.
 *
 * Written by scripts/sign-release.mjs. The private half is on the machine
 * that publishes and is in no repository. An update whose manifest does not
 * verify against this is refused, so replacing the release files is not
 * enough to make an app install something.
 */
export const RELEASE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAiYngcs+fJhW1JaZ+eSk+GD7XBh3lVlGkakQroEjXXPo=
-----END PUBLIC KEY-----
`;
