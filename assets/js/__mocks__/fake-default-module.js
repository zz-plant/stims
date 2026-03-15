export default {
  start({ container }) {
    const node = document.createElement('div');
    node.dataset.fakeDefaultToy = 'true';
    container.appendChild(node);

    return {
      dispose() {
        node.remove();
      },
    };
  },
};
