module.exports = function rawMarkdown(source) {
  return `export default ${JSON.stringify(source)};`;
};
