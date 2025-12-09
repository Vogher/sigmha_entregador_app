// babel.config.js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // se você usa imports como "@/foo/bar"
      ['module-resolver', { alias: { '@': './src' } }],
      // se você NÃO usa alias "@", pode remover a linha acima
      // OBS: só adicione 'react-native-reanimated/plugin' se o pacote estiver instalado
    ],
  };
};
