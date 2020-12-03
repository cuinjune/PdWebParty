## How to rebuild files in this directory

The emscripten backend of PdWebParty was originally written and compiled for the Purr Data web app.  
You can learn more about the project from this repo: https://git.purrdata.net/jwilkes/purr-data/-/tree/emscripten/emscripten/project/purr-data

Here's the instructions on how to rebuild the emscripten backend:

First, install/activate emscripten:
```
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
git pull
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh
cd ..
```

Then, clone and build Purr Data for emscripten:
```
git clone https://git.purrdata.net/jwilkes/purr-data.git
cd purr-data
git checkout emscripten
make emscripten
```

It will take a while building everything, and once it's done, you can rebuild with "make -C emscripten" which will be faster.

You can find the source files for emscripten from "emscripten/src" and get the compiled blobs from "emscripten/build".
