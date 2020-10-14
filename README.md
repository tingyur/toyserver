# toyserver

Most of the code of this package is copied from vite, in order to learn how to write local server, do not use it.

## Commit Message Format

If the prefix is feat, fix or perf, it will appear in the changelog. However if there is any BREAKING CHANGE, the commit will always appear in the changelog.

Other prefixes are up to your discretion. Suggested prefixes are build, ci, docs ,style, refactor, and test for non-changelog related tasks.

Details regarding these types can be found in the official [Angular Contributing Guidelines](1).

Breaking Changes should start with the word BREAKING CHANGE: with a space or two newlines. The rest of the commit message is then used for this.

### Type

- build: Changes that affect the build system or external dependencies (example scopes: gulp, broccoli, npm)
- ci: Changes to our CI configuration files and scripts (example scopes: Circle, BrowserStack, SauceLabs)
- docs: Documentation only changes
- feat: A new feature
- fix: A bug fix
- perf: A code change that improves performance
- refactor: A code change that neither fixes a bug nor adds a feature
- test: Adding missing tests or correcting existing tests

[1]: https://github.com/angular/angular/blob/master/CONTRIBUTING.md#commit
