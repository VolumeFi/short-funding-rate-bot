import Web3 from "web3";
import { promisify } from "util";
import axios from 'axios';
import sqlite3 from "sqlite3";
import { LCDClient, MsgExecuteContract, MnemonicKey } from '@palomachain/paloma.js';
import { promises as fs } from 'fs';
import crvusdPackage from "@curvefi/stablecoin-api";
import pg from 'pg';
const { Pool } = pg;

let crvusd = crvusdPackage.default;

let cachedData = [];

import dotenv from 'dotenv';
dotenv.config();

const PALOMA_LCD = process.env.PALOMA_LCD;
const PALOMA_CHAIN_ID = process.env.PALOMA_CHAIN_ID;
const PALOMA_PRIVATE_KEY = process.env.PALOMA_KEY;
const TELEGRAM_ALERT_API = process.env.TELEGRAM_ALERT_API;


const pool = new Pool({
    user: process.env.PG_USER,
    host: process.env.PG_HOST,
    database: process.env.PG_DATABASE,
    password: process.env.PG_PASSWORD,
    port: process.env.PG_PORT,
});

let WETH = null;
let web3 = null;
let contractInstance = null;
let COINGECKO_CHAIN_ID = null;
let ADDRESS = null;
let networkName = null;
let connections = null;
let FROM_BLOCK = null;
let CW = null;
let DEX = null;
let BOT = "short-funding";
const BOT_NAME = BOT;
let NODE = null;

(function() {
    var originalConsoleLog = console.log;

    console.log = function() {
        var args = Array.from(arguments).map(argument => {
            if (typeof argument === 'string') {
                // Replace newline characters with spaces for string arguments
                return argument.replace(/\n/g, ' ');
            } else if (typeof argument === 'object') {
                // Convert object to string and replace newline characters
                return JSON.stringify(argument).replace(/\n/g, ' ');
            }
            return argument;
        });

        originalConsoleLog.apply(console, args);
    };
})();

//const mixpanel = require('mixpanel').init('eaae482845dadd88e1ce07b9fa03dd6b');

async function setupConnections() {
    const data = await fs.readFile('./networks.json', 'utf8');
    const configs = JSON.parse(data);

    connections = configs.map(config => {
        console.log(config.NODE);
        let web3 = null;
        try {
            web3 = new Web3(config.NODE);
        } catch (err) {
            console.log("Web3 Issue:",  err);
        }

        return {
            web3: web3,
            contractInstance: new web3.eth.Contract(JSON.parse(config.ABI), config.VYPER),
            address: config.VYPER,
            coingeckoChainId: config.COINGECKO_CHAIN_ID,
            networkName: config.NETWORK_NAME,
            dex: config.DEX,
            weth: config.WETH,
            fromBlock: config.FROM_BLOCK,
            cw: config.CW,
            node: config.NODE
        };
    });
}

setupConnections().then(r => {
});

function withRetry(fn, retries = 4, delay = 2000) {
    return async function(...args) {
        for (let i = 0; i < retries; i++) {
            try {
                return await fn(...args);
            } catch (error) {
                if (i === retries - 1) throw error;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    };
}

let db = new sqlite3.Database(process.env.DB_LOCATION);
db.getAsync = withRetry(promisify(db.get).bind(db));
db.runAsync = withRetry(promisify(db.run).bind(db));
db.allAsync = withRetry(promisify(db.all).bind(db));

let processing = false;

async function getLastBlock() {
    if (processing) {
        return 0;
    } else {
        processing = true;
    }

    for (const connection of connections) {
         web3 = connection.web3;
         contractInstance = connection.contractInstance;
         ADDRESS = connection.address;
         COINGECKO_CHAIN_ID = connection.coingeckoChainId;
         networkName = connection.networkName;
         WETH = connection.weth;
         FROM_BLOCK = connection.fromBlock;
         CW = connection.cw;
         DEX = connection.dex;
         
         NODE = connection.node;

        try {
            const row = await db.getAsync(`
                SELECT * FROM fetched_blocks
                WHERE network_name = ? AND dex = ? AND bot = ? AND contract_instance = ?
                AND ID = (
                    SELECT MAX(ID) FROM fetched_blocks
                    WHERE network_name = ? AND dex = ? AND bot = ? AND contract_instance = ?
                )`, [networkName, DEX, BOT, ADDRESS, networkName, DEX, BOT, ADDRESS]);

            let fromBlock = 0;

            if (row === undefined) {
                const data = [FROM_BLOCK - 1, networkName, DEX, BOT, ADDRESS];
                await db.runAsync(`
                    INSERT INTO fetched_blocks (block_number, network_name, dex, bot, contract_instance)
                    VALUES (?, ?, ?, ?, ?);
                `, data);

                fromBlock = Number(FROM_BLOCK);
            } else {
                fromBlock = row["block_number"] + 1;
            }

            await getNewBlocks(fromBlock);

        } catch (err) {
            console.log(err);
        }
        await delay(6 * 1000);
    }

    processing = false;
}


function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function finishDeposits(block, bot) {
    const sql = `UPDATE deposits
                 SET withdraw_block = ?
                 WHERE depositor = ?
                   and contract = ?
                   and bot = ?`;

    try {
        await db.runAsync(sql, [block, bot, ADDRESS, BOT_NAME]);
        console.log('finishDeposits [block, bot, ADDRESS, BOT_NAME]','Row inserted successfully.', block, bot, ADDRESS, BOT_NAME);
    } catch (err) {
        console.log('finishDeposits', 'Error inserting row:', err.message, block, bot, ADDRESS, BOT_NAME);
    }
}

async function insertIntoDeposits(owner, bot, transaction_hash) {
  console.log(
    "insertIntoDeposits transaction_hash owner bot:",
    transaction_hash,
    owner,
    bot
  );

  try {
    const depositPrice = await getTokenPrice(collateral, collateral_amount);
    const transactionFee = await getTransactionFee(transaction_hash);

    const insertSql = `INSERT INTO deposits
                       (withdrawer, depositor, contract, bot, bot_type, transaction_hash, network_name, deposit_price, fees_charged)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    await db.runAsync(insertSql, [
      owner,
      owner,
      ADDRESS,
      bot,
      N,
      transaction_hash,
      networkName,
      depositPrice,
      transactionFee,
    ]);

    console.log("Row inserted successfully.");
  } catch (err) {
    console.log("insertIntoDeposits error in operation:", err.message);
  }
}

async function updateDeposits(bot, amount) {
    try {
      const updateSql = `UPDATE deposits SET amount = ${amount} WHERE bot = ${bot}`;

      await db.runAsync(updateSql);
    } catch (err) {
      console.log("Error updating row:", err.message);
    }
}

async function updateDepositPrice(deposit_price, loan_amount, id) {
    console.log('updateDepositPrice(deposit_price, loan_amount, id)', deposit_price, loan_amount, id);
    try {
        const updateFields = ['deposit_price = ?'];
        const updateValues = [deposit_price, id];

        const updateSql = `UPDATE deposits SET ${updateFields.join(', ')} WHERE id = ?`;

        await db.runAsync(updateSql, updateValues);
    } catch (err) {
        console.log('Error updating row:', err.message);
    }
}

async function processDeployedEvents(deployed_events) {
  for (const deposited_event of deposited_events) {
    const {
      owner,
      bot,
    } = deposited_event.returnValues;

    const transaction_hash = deposited_event.transactionHash;

    let existingDeposit = await db.getAsync(
      `SELECT id, remaining_counts FROM deposits WHERE deposit_id = ? AND bot = ? AND network_name = ? AND contract = ?`,
      [deposit_id, BOT_NAME, networkName, ADDRESS]
    );

    if (!existingDeposit) {
      await insertIntoDeposits(owner, bot, transaction_hash);
    }
  }
}


async function processDepositEvents(deposit_events) {
  console.log("processDepositEvents(deposit_events)");

  for (const deposit_event of deposit_events) {
    const { bot, amount0 } = deposit_event.returnValues;

    await updateDeposits(bot, amount0);
  }
}

async function processWithdrawEvents(withdrawn_events) {
  console.log("processWithdrawEvents(withdrawn_events)");

  for (const withdrawn_event of withdrawn_events) {
    const { bot, amount0 } = withdrawn_event.returnValues;
    const block_number = withdrawn_event.blockNumber;
    await finishDeposits(block_number, bot);
  }

  if (withdrawn_events.count > 0) {
    console.log("All deposit records have been updated in order.");
  }
}


async function processCanceledEvents(canceled_events_events) {
  console.log("processCanceledEvents(canceled_events_events)");

  for (const canceled_events_event of canceled_events_events) {
    const { bot } = canceled_events_event.returnValues;
    const block_number = canceled_events_event.blockNumber;
    await finishDeposits(block_number, bot);
  }

  if (withdrawn_events.count > 0) {
    console.log("All deposit records have been updated in order.");
  }
}

async function getNewBlocks(fromBlock) {
    const block_number = Number(await web3.eth.getBlockNumber());
    
    let deployed_events = [];
    let deposited_events = [];
    let withdrawn_events = [];
    let canceled_events = [];
    

    for (let i = fromBlock; i <= block_number; i += 10000) {
        let toBlock = i + 9999;
        if (toBlock > block_number) {
            toBlock = block_number;
        }

        const new_deployed_events = await contractInstance.getPastEvents(
          "BotDeployed",
          {
            fromBlock: i,
            toBlock: toBlock,
          }
        );

        const new_deposited_events = await contractInstance.getPastEvents(
          "Deposited",
          {
            fromBlock: i,
            toBlock: toBlock,
          }
        );

        const new_withdrawn_events = await contractInstance.getPastEvents(
          "Withdrawn",
          {
            fromBlock: i,
            toBlock: toBlock,
          }
        );

        const new_canceled_events = await contractInstance.getPastEvents(
          "Canceled",
          {
            fromBlock: i,
            toBlock: toBlock,
          }
        );

        deployed_events = deployed_events.concat(new_deployed_events);
        deposited_events = deposited_events.concat(new_deposited_events);
        withdrawn_events = withdrawn_events.concat(new_withdrawn_events);
        canceled_events = canceled_events.concat(new_canceled_events);

         const data = [block_number, networkName, DEX, BOT, ADDRESS];
         await db.runAsync(
           `update fetched_blocks
                       set block_number = ?
                       where network_name = ?
                         and dex = ?
                         and bot = ?
                         and contract_instance = ?;`,
           data
         );
    }

    await processDeployedEvents(deployed_events);
    await processWithdrawEvents(withdrawn_events);
    await processDepositEvents(deposited_events);
    await processCanceledEvents(canceled_events);

    const withdraws = await cycleDeposits();

    await executeWithdraw(withdraws);

    processing = false;
}

async function cycleDeposits() {
    const deposits = await getPendingDeposits();
    let withdraws = [];

    console.log('cycleDeposits', deposits);
    for (const deposit of deposits) {

    }

    return withdraws;
}

async function fetchDeposits(remainingCounts = false) {
  let query = `
        SELECT * FROM deposits 
        WHERE  withdraw_block IS NULL  
    `;

  query += ` AND LOWER(contract) = LOWER('${ADDRESS}')`;
  query += ` AND LOWER(bot) = LOWER('${BOT}');`;

  try {
    let rows = await db.allAsync(query);
    return rows;
  } catch (error) {
    console.log("Error fetching deposits: ", error);
    throw error;
  }
}


async function executeWithdraw(withdraws) {

}

async function processDeposits() {
    await cacheData();

    setInterval(getLastBlock, 2500 * 1);
    setInterval(await cacheData, 20 * 60 * 1000);
}

async function getPendingDeposits() {
    let dbAll = promisify(db.all).bind(db);

    let bot = BOT;
    let contract = ADDRESS;

    try {
        let rows;
        let query = `SELECT *
                     FROM deposits
                     WHERE withdraw_block IS NULL`;
        query += ` AND LOWER(contract) = LOWER(?)`;
        query += ` AND LOWER(bot) = LOWER(?)`;


        rows = await dbAll(query, contract, bot);

        return rows;
    } catch (err) {
        console.log(err.message);
    }
}

async function cacheData() {
  try {
    const data = await fs.readFile('gecko.json', 'utf8');
    cachedData = JSON.parse(data);
    console.log("Data cached successfully");
  } catch (err) {
    console.log("Error:", err);
  }
}

function findIdByHash(hash) {
    try {
        const lowerCaseHash = hash.toLowerCase();

        for (const item of cachedData) {
            const platforms = item.platforms;

            for (const platformHash of Object.values(platforms)) {
                if (platformHash && platformHash.toLowerCase() === lowerCaseHash) {
                    return item.id.toLowerCase();
                }
            }
        }

        return null;
    } catch (error) {
        console.log('Error occurred:', error);

        return null;
    }
}

async function getDecimalPlaces(token0) {
    let result = 18;

    if (token0 == "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE") {
        return result;
    }

    let token_data = null;
    try {
        token_data = await fetchTokenData(token0);

        if (token_data) {
            let divisor = token_data.divisor;
            result = parseFloat(divisor);
        }
    } catch (e) {
        console.log(e);
    }

    if (isNaN(result)) {
        return 18;
    }

    if (result == 0) {
        return 18;
    }

    return result;
}
async function getTokenPrice(hash, amount) {
    try {
        let tokenId = findIdByHash(hash);

        const url = `https://pro-api.coingecko.com/api/v3/simple/price?ids=${tokenId}&vs_currencies=usd&x_cg_pro_api_key=${process.env.COINGECKO_API_KEY}`;
        const response = await axios.get(url);
        const priceInUSD = response.data[tokenId].usd;

        const decimalPlaces = await getDecimalPlaces(hash);

        const adjustedAmount = amount / Math.pow(10, decimalPlaces);

        return adjustedAmount * priceInUSD;
    } catch (error) {
        console.log(`Error fetching token price: ${error}`);
        return null;
    }
}

async function fetchTokenData(tokenID) {
    const queryText = "SELECT data FROM token WHERE id = $1";
    const res = await pool.query(queryText, [tokenID]);

    if (res.rows.length > 0) {
        return res.rows[0].data[0];
    } else {
        const response = await axios({
            url: `https://api.etherscan.io/api?module=token&action=tokeninfo&contractaddress=${tokenID}&apikey=${process.env.ETHERSCAN_KEY}`,
            method: "get",
            timeout: 8000,
            headers: {
                "Content-Type": "application/json",
            },
        });

        if (response.data.message !== "NOTOK") {
            const insertText = "INSERT INTO token(id, data) VALUES($1, $2)";
            await pool.query(insertText, [tokenID, JSON.stringify(response.data.result)]);

            return response.data.result;
        } else {
            console.log(tokenID, response.data);
        }
    }
}

async function getTransactionFee(txHash) {
    console.log('getTransactionFee(txHash)', txHash);
    try {
        const url = `https://api.etherscan.io/api?module=proxy&action=eth_getTransactionByHash&txhash=${txHash}&apikey=${process.env.ETHERSCAN_KEY}`;
        const response = await axios.get(url);
        const transaction = response.data.result;

        if (!transaction) {
            throw new Error('Transaction not found');
        }

        const gasUsed = BigInt(transaction.gas);
        const gasPrice = BigInt(transaction.gasPrice);

        const feeInWei = gasUsed * gasPrice;
        const feeString = feeInWei.toString();

        const decimalPosition = feeString.length - 18;
        let feeInEth;

        if (decimalPosition > 0) {
            feeInEth = feeString.slice(0, decimalPosition) + '.' + feeString.slice(decimalPosition);
        } else {
            feeInEth = '0.' + '0'.repeat(-decimalPosition) + feeString;
        }

        return feeInEth.toString();
    } catch (error) {
        throw new Error(`Error fetching transaction fee: ${error.message}`);
    }
}

export { processDeposits };
