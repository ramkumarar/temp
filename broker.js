const request = require("request");
exports.querymessage = (queryText) => {
    let baseurl = 'https://chat-broker.herokuapp.com/message'
    let urlWithParams = `${baseurl}/${queryText}`


    return new Promise((resolve, reject) => request(urlWithParams, function (error, response, body) {
        if (error) {
            console.error(JSON.stringify(error));
            reject(error);
        } else if (response.statusCode < 200 || response.statusCode > 299) {
            console.error("Unexpected Error");
            reject("Unexpected Error");
        } else {
            resolve(body);
        }
    }));

}