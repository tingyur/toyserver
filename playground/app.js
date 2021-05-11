import { sayHello } from './hello'

const root = document.getElementById('root')
function render() {
  root.innerHTML = document.createTextNode(sayHello())
}

render()

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    render()
  })
}
