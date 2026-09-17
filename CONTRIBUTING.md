# Contributing to KnotKitchen

Thank you for considering contributing to **KnotKitchen**! 🎉

## How to Contribute

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Development Setup

### Backend
```bash
cd pos-backend
npm install
npm run dev
```

### Frontend
```bash
cd pos-frontend
npm install
npm run dev
```

## Code Style
- Follow the existing code conventions
- Write clean, readable, and well-documented code
- Test your changes thoroughly before submitting

## Development rule: fix the module, do not add a file

Before creating a new file to fix a bug, check whether the behaviour already
belongs to an existing module and change it there. A new file is right only
when it carries a genuinely separate responsibility (a new feature, a shared
helper used from more than one place, a component with its own state). Never
add `*Fix`, `*V2`, `*New`, `*Old`, `temp` or `backup` files; never keep two
implementations of one rule. See the "Code map" section of
[ARCHITECTURE.md](ARCHITECTURE.md) for where each kind of code lives.

## Reporting Issues
Use the GitHub issue tracker to report bugs or suggest features. Provide as much detail as possible.