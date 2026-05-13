/** @type {import('@electron-forge/shared-types').ForgeConfig} */
module.exports = {
  packagerConfig: {
    asar: true,
    ignore: [
      /^\/test($|\/)/,
      /^\/src($|\/)/,
      /^\/\.data($|\/)/,
      /^\/\.symphonia($|\/)/,
      /^\/out($|\/)/,
    ],
  },
  makers: [
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin", "linux", "win32"],
    },
  ],
};
