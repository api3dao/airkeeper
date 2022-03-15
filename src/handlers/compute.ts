import {range} from "lodash";
import {ethers} from "ethers";
import * as sqlite from 'sqlite3';

const sqlite3 = sqlite.verbose();
import {deriveSponsorWallet} from "../wallet";
// eslint-disable-next-line import/order
import {existsSync, rmSync} from "fs";
import * as crypto from "crypto";

export enum Functions {
  deriveSponsorWallet = 'deriveSponsorWallet'
}

export interface ComputeFunction {
  fnName: Functions;

}

export const handler = async (event: any = {}): Promise<any> => {
  rmSync(`/tmp/airkeeper.db`);
  const initDb = !existsSync(`/tmp/airkeeper.db`);
  const db = new sqlite3.Database('/tmp/airkeeper.db');

  if (initDb) {
    await new Promise((resolve) => {
      db.exec(`CREATE TABLE IF NOT EXISTS wallets (privKey TEXT PRIMARY KEY, wallet TEXT, sponsor TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`, resolve);
    });
  }

  {
    console.log("generating wallets - empty db");
    const testData = range(100).map(() => {
      const randomWallet = ethers.Wallet.createRandom().mnemonic.phrase;
      const randomSponsor = ethers.Wallet.createRandom().address;

      return {randomWallet, randomSponsor};
    });
    const startedAt = Date.now();
    console.log(event);

    for (let i = 0; i < testData.length; i++) {
      const {randomWallet, randomSponsor} = testData[i];

      const dbResult = await new Promise((resolve, reject) => {
        db.get(`SELECT privKey FROM wallets WHERE wallet = ? AND sponsor = ?;`, [randomWallet, randomSponsor], (err, row) => {
          if (err) {
            reject(err);
          }

          if (row?.privKey) {
            return row.privKey;
          }

          return undefined;
        });
      });

      if (dbResult) {
        return dbResult;
      }

      const sponsorWallet = deriveSponsorWallet(
        randomWallet,
        randomSponsor,
        '2' // TODO: should this be in a centralized enum somewhere (api3/airnode-protocol maybe)?
      );

      await new Promise((res) => {
        db.run(`INSERT INTO wallets (privKey, wallet, sponsor) VALUES (?, ?, ?);`, [sponsorWallet.privateKey, randomWallet, randomSponsor], res);
      });

      console.log(sponsorWallet);
    }
    //
    // const somedata = testData.map(async ({randomWallet, randomSponsor}) => {
    //   const dbResult = await new Promise((resolve, reject) => {
    //     db.get(`SELECT privKey FROM wallets WHERE wallet = ? AND sponsor = ?;`, [randomWallet, randomSponsor], (err, row) => {
    //       if (err) {
    //         reject(err);
    //       }
    //
    //       if (row?.privKey) {
    //         return row.privKey;
    //       }
    //
    //       return undefined;
    //     });
    //   });
    //
    //   if (dbResult) {
    //     return dbResult;
    //   }
    //
    //   const sponsorWallet = deriveSponsorWallet(
    //     randomWallet,
    //     randomSponsor,
    //     '2' // TODO: should this be in a centralized enum somewhere (api3/airnode-protocol maybe)?
    //   );
    //
    //   await new Promise((res) => {
    //     db.run(`INSERT INTO wallets (privKey, wallet, sponsor) VALUES (?, ?, ?);`, [sponsorWallet.privateKey, randomWallet, randomSponsor], res);
    //   });
    //
    //   return sponsorWallet;
    // });

    const endedAt = Date.now();
    // console.log(await Promise.all(somedata));
    console.log("Wallet derivation: ", endedAt - startedAt);
  }

  {
    console.log("generating wallets - populated db");
    const testData = range(100).map(() => {
      const randomWallet = ethers.Wallet.createRandom().mnemonic.phrase;
      const randomSponsor = ethers.Wallet.createRandom().address;

      return {randomWallet, randomSponsor};
    });
    const startedAt = Date.now();
    console.log(event);

    const somedata = testData.map(async ({randomWallet, randomSponsor}) => {
      const dbResult = await new Promise((resolve, reject) => {
        db.get(`SELECT privKey FROM wallets WHERE wallet = ? AND sponsor = ?;`, [randomWallet, randomSponsor], (err, row) => {
          if (err) {
            reject(err);
          }

          if (row?.privKey) {
            return row.privKey;
          }

          return undefined;
        });
      });

      if (dbResult) {
        return dbResult;
      }

      const sponsorWallet = deriveSponsorWallet(
        randomWallet,
        randomSponsor,
        '2' // TODO: should this be in a centralized enum somewhere (api3/airnode-protocol maybe)?
      );

      db.run(`INSERT INTO wallets (privKey, wallet, sponsor) VALUES (?, ?, ?);`, [sponsorWallet.privateKey, randomWallet, randomSponsor]);

      return sponsorWallet;
    });

    const endedAt = Date.now();
    console.log("Wallet derivation: ", endedAt - startedAt);
    console.log(somedata);
  }

  // hash subscription id
  {
    console.log("generating wallets");
    const testData = range(1).map(() => {
      const randomWallet = ethers.Wallet.createRandom().mnemonic.phrase;
      const randomSponsor = ethers.Wallet.createRandom().address;
      const randomBytes = ethers.utils.randomBytes(100);

      return {randomWallet, randomSponsor, randomBytes};
    });

    const randomInt = crypto.randomInt(1000000000);

    const startedAt = Date.now();
    const someData = testData.map(({randomWallet, randomBytes, randomSponsor}) => {
      const expectedSubscriptionId = ethers.utils.solidityKeccak256(
        ['uint256', 'address', 'bytes32', 'bytes', 'bytes', 'address', 'address', 'address', 'bytes4'],
        [
          randomInt,
          randomSponsor,
          randomBytes.slice(0, 32),
          randomBytes,
          randomBytes,
          randomSponsor,
          randomSponsor,
          randomSponsor,
          randomBytes.slice(0, 4),
        ]
      );
      return expectedSubscriptionId;
    });
    const endedAt = Date.now();

    console.log(someData);
    console.log("solidity keccak: ", endedAt - startedAt);
  }

  {
    console.log("do signing 1");
    const testData = range(1).map(() => {
      const randomWallet = ethers.Wallet.createRandom();

      return {randomWallet};
    });

    const randomBytes = ethers.utils.randomBytes(300);

    console.log(event);
    const startedAt = Date.now();

    // const contract = new ethers.Contract(ethers.Wallet.createRandom().address, dapiServerAbi, new ethers.providers.JsonRpcProvider());

    const _someData = testData.map(({randomWallet}) => {
      return randomWallet.signMessage(randomBytes);
    });

    const endedAt = Date.now();
    console.log("signing: ", endedAt - startedAt);

  }

  {
    console.log("do signing 10");
    const testData = range(10).map(() => {
      const randomWallet = ethers.Wallet.createRandom();

      return {randomWallet};
    });

    const randomBytes = ethers.utils.randomBytes(300);

    console.log(event);
    const startedAt = Date.now();

    // const contract = new ethers.Contract(ethers.Wallet.createRandom().address, dapiServerAbi, new ethers.providers.JsonRpcProvider());

    const _someData = testData.map(({randomWallet}) => {
      return randomWallet.signMessage(randomBytes);
    });

    const endedAt = Date.now();
    console.log("signing: ", endedAt - startedAt);

  }

  {
    console.log("do signing 100");
    const testData = range(100).map(() => {
      const randomWallet = ethers.Wallet.createRandom();

      return {randomWallet};
    });

    const randomBytes = ethers.utils.randomBytes(300);

    console.log(event);
    const startedAt = Date.now();

    // const contract = new ethers.Contract(ethers.Wallet.createRandom().address, dapiServerAbi, new ethers.providers.JsonRpcProvider());

    const _someData = testData.map(({randomWallet}) => {
      return randomWallet.signMessage(randomBytes);
    });

    const endedAt = Date.now();
    console.log("signing: ", endedAt - startedAt);
  }


  {
    console.log("invoke Lambda - serial");
    const lambda = new Lambda();

    const startedAt = Date.now();

    for (let i = 0; i < 50; i++) {
      const startedAt = Date.now();
      const result = await lambda.invoke({
        InvocationType: 'RequestResponse',
        FunctionName: 'airkeeper-benchmark-roundtrip',
        LogType: 'Tail',
        Payload: ""
      }).promise();
      const endedAt = Date.now();
      console.log("lambda result", result);
      console.log("lambda serial invoke : ", i, " ", endedAt - startedAt);
    }

    const endedAt = Date.now();
    console.log("signing: ", endedAt - startedAt);
  }

  {
    console.log("invoke test");
    const lambda = new Lambda();

    const startedAt = Date.now();
    const promises = await Promise.all(range(100).map(async () => {
        const startedAt = Date.now();
        await lambda.invoke({
          InvocationType: 'RequestResponse',
          FunctionName: 'airkeeper-benchmark-roundtrip',
          LogType: 'Tail',
          Payload: ""
        }).promise();
      const endedAt = Date.now();
      return (endedAt-startedAt);
      }
    ));

    const endedAt = Date.now();
    console.log("lambda async invoke: ", endedAt - startedAt);
    console.log(promises);
  }

  const callAPIFn = async (runs: number) => {
    console.log("call API test", runs);

    const startedAt = Date.now();
    // https://i9zjclss79.execute-api.us-east-1.amazonaws.com/default/stress-tester-mock-coingecko-api
    const options = {
      hostname: 'i9zjclss79.execute-api.us-east-1.amazonaws.com',
      port: 443,
      path: '/default/stress-tester-mock-coingecko-api',
      method: 'GET'
    };
    const promises = await Promise.all(range(runs).map(async () => {
        const startedAt = Date.now();

        await new Promise((resolve) => {
          get(options, resolve);
        });

        const endedAt = Date.now();
        return (endedAt-startedAt);
      }
    ));

    const endedAt = Date.now();
    console.log("call api batch async invoke: ", runs,  endedAt - startedAt);
    console.log(promises);
  };
  //
  // await callAPIFn(1);
  // await callAPIFn(10);
  // await callAPIFn(100);
  // await callAPIFn(500);
  // await callAPIFn(1000);
  // await callAPIFn(1500);
  // await callAPIFn(2000);

  const response = {
    ok: true,
    data: {message: 'PSP beacon update execution has finished'},
  };
  return {statusCode: 200, body: JSON.stringify(response)};
};


// handler({fnName: Functions.deriveSponsorWallet});