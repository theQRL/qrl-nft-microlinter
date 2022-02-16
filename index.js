const express = require('express')
const bodyParser = require('body-parser')
const cors = require("cors")
const jsonStringify = require('json-stable-stringify')
const validateQRLaddress = require('@theqrl/validate-qrl-address')
const crypto = require('crypto')
const process = require('process');
const fs = require('fs')
const { ESLint } = require('eslint')

const app = express()
const port = process.env.PORT || 3000;

app.use(
  cors({
    origin: "*",
  })
);

function formatMessages(messages) {
  const errors = messages.map((message) => {
    return `L${message.line}:${message.column} ${message.message.slice(
      0,
      -1
    )}`;
  });

  return `${errors.join('')}`;
}

async function validateJSON(json) {
  try {
    if (!json.provider) {
      return {valid: false, message: "provider JSON key not present"}
    }
    if (!json.metadata) {
      return {valid: false, message: "metadata JSON key not present"}
    }
    if (json.filehash.length !== 128) {
      return {valid: false, message: "invalid filehash length"}
    }
    if (json.standard !== 1) {
      return {valid: false, message: "invalid standard version"}
    }
    if (json.metahash.length !== 128) {
      return {valid: false, message: "invalid metahash length"}
    }
    if (!validateQRLaddress.hexString(json.provider).result) {
      return {valid: false, message: "invalid provider QRL address"}
    }

    // hashes to lowercase
    json.filehash = json.filehash.toLowerCase()
    json.metahash = json.metahash.toLowerCase()
    
    // QRL address to lowercase except initial 'Q'
    json.provider = `Q${json.provider.toLowerCase().slice(1,79)}`

    const { metadata } = json
    const jsonStrMetadata = jsonStringify(metadata)
    const hash = crypto.createHash('sha512')
    const data = hash.update(jsonStrMetadata, 'utf-8')
    const generatedHash = data.digest('hex');
    if (generatedHash !== json.metahash) {
      return {valid: false, message: "invalid hash of metadata"}
    }
    // write file
    const randomHex = crypto.randomBytes(8).toString("hex")
    const content = jsonStringify(json, { space: '  ' })
    await fs.promises.writeFile(`./tmp/${randomHex}.json`, content)

    // lint file
    const engine = new ESLint({
      useEslintrc: true,
    })
    const results = await engine.lintFiles([`./tmp/${randomHex}.json`])
    if (results[0].messages.length > 0) {
      return {valid: false, message: "JSON fails linting checks"}
    }

    // clean up
    await fs.promises.unlink(`./tmp/${randomHex}.json`)
    return {valid: true, linted: jsonStringify(json, { space: '  ' })}
  } catch (e) {
    console.log(e)
    return {valid: false, message: "failed to parse JSON"}
  }
}

app.use(bodyParser.json({ extended: true }))

app.use((err, req, res, next) => {
    // This check makes sure this is a JSON parsing issue, but it might be
    // coming from any middleware, not just body-parser:

    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        console.error('Bad request: malformed JSON');
        return res.sendStatus(400); // Bad request
    }

    next();
});

app.get('/', (req, res) => {
  res.send('<html><body> \
    <script> \
    async function submitform(e) { \
      document.getElementById("s").style.display="none"; \
      try { \
     var form = document.querySelector("#formElem"); \
    var data = JSON.parse(form.querySelector("textarea").value); \
    console.log(data);\
        let response = await fetch("http://localhost:3000/lint", { \
                method: "POST", \
                headers: { \
                    "Content-Type": "application/json", \
                }, \
                body: JSON.stringify(data), \
        }); \
        \
        let text = await response.text(); \
        console.log(text); \
        const jsonR = JSON.parse(text); \
        if (jsonR.valid) { \
          document.querySelector("#valid").textContent = "PASS - valid data"; \
          document.querySelector("#message").textContent = ""; \
          document.querySelector("#safeJson").textContent = jsonR.linted; \
          document.getElementById("s").style.display="block"; \
        } \
          else { \
        document.querySelector("#valid").textContent = "FAIL - "; \
        document.querySelector("#message").textContent = jsonR.message }; \
      } catch (e) { \
        console.log(e); \
        document.querySelector("#valid").textContent = "FAIL - Invalid JSON / unable to parse form data"; \
      } \
      } \
      </script> \
    <h1>QRL NFT JSON microservice</h1> \
     <p>See the docs for usage</p> \
     <form id="formElem"><textarea style="width: 100%; height: 300px;"></textarea></form> \
     <p><button id="check" onclick="submitform()">Check</button></p> \
     <p><span id="valid"></span><span id="message"><span></p><br />\
     <div id="s" style="display:none;">Linted data:<br /> \
     <textarea id="safeJson" style="width: 100%; height: 200px;" ></textarea></div> \
     </body></html> \
  ')
})

// POST must have valid json in body
app.post('/lint', async (req, res) => {
  const json = req.body
  let isValid = false
  isValid = await validateJSON(json)
  res.send(isValid)
})

app.listen(port, () => {
  console.log(`QRL-NFT linting microservice listening on port ${port}`)
})
