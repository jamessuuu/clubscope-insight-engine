/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // packages/core ships TypeScript source rather than a build artifact: one less build
  // step, and the API and web app are guaranteed to run the exact same code.
  transpilePackages: ['@clubscope/core'],
  // Promoted out of `experimental` in Next 15.1; leaving it nested only earns a warning.
  typedRoutes: true,
  experimental: {
    // core's tsconfig is `module: NodeNext`, so its relative imports carry a `.js`
    // extension even though the files on disk are `.ts`. Node resolves that pairing;
    // webpack does not unless it is told the mapping, and without this line every import
    // into core fails the build with "Can't resolve './provider.js'".
    extensionAlias: { '.js': ['.ts', '.tsx', '.js'] },
  },
};
export default nextConfig;
