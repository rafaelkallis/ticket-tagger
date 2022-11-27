# Ticket Tagger 

Machine learning driven issue classification bot.
[Add to your repository now!](https://github.com/apps/ticket-tagger/installations/new)

![AGPL](https://www.gnu.org/graphics/agplv3-88x31.png)
![Build](https://github.com/rafaelkallis/ticket-tagger/workflows/Continuous%20Integration/badge.svg)

![use ticket tagger](https://thumbs.gfycat.com/GreedyBrownHochstettersfrog-size_restricted.gif)

### Installation

Visit our [GitHub App](https://github.com/apps/ticket-tagger) and install.

![install ticket tagger](https://thumbs.gfycat.com/AfraidLongGreatargus-size_restricted.gif)

### License

Ticket Tagger is licensed under the GNU Affero General Public License. Every file should include a license header, if not, the following applies:

```
Ticket Tagger automatically predicts and labels issue types.
Copyright (C) 2018-2023  Rafael Kallis

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>. 
```

Carefully read the [full license agreement](https://www.gnu.org/licenses/agpl-3.0.en.html).

> "... [The AGPL-3.0 license] requires the operator of a network server to provide the source code of the modified version running there to the users of that server."

### Derivative Work

- [BEE](https://github.com/sea-lab-wm/bee-tool), Yang Song and Oscar Chaparro
- [Github Issue Classification Evaluation](https://github.com/ChristianBirchler/ticket-tagger-analysis), Tim Moser, David Steiger, Christian Birchler, Lara Fried, Sebastiano Panichella, Rafael Kallis

### References

- [Building GitHub Apps](https://developer.github.com/apps/building-github-apps/)
- [Fasttext](https://fasttext.cc)

### Development

#### notice:

- nodejs is required to compile/install dependencies

#### get started:

```sh
git clone https://github.com/rafaelkallis/ticket-tagger ticket-tagger
cd ticket-tagger

# compile/install dependencies
npm install

# run linter
npm run lint

# run tests
npm test

# run server
NODE_ENV="development" npm start
```
