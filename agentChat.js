    'use strict';

const util = require('util');
const request = require('request');
const config = require('../config/config');
const transcript = require('../chats/transcript.json');
var rp = require('request-promise');


function truncateAfter(str, pattern) {
    return str.slice(0, str.indexOf(pattern));
  }

 function fetchLITagValues(str) {
    return str.match(/<li>(.*?)<\/li>/g).map(function(val){
        return val.replace(/<\/?li>/g,'');
     });
 }



function getNextPingURL(linkArr) {
    for (let i = 0; i < linkArr.length; i++) {
        const link = linkArr[i];
        if (link['@rel'] === 'next') {
            return link['@href'].replace('/events', '/events.json');
        }
    }
}

function textToStructuredContent(arr) {
    const buttons= arr.map(
        str =>  {
            const action= {type:'publishText',text:str}
            const clickAction= {actions: [action]}
            const button = {
                type:'button',
                tooltip: str,
                title : str,
                click:clickAction
            };
            return button
        }
    );

    const sText= {type:'vertical',elements:buttons}
    return sText
}

class AgentChat {
    constructor(session, chatURL) {
        this.session = session;
        this.chatURL = chatURL;
        this.lineIndex = 0;
        this.chatPingInterval = 2000;
    }

    start(callback) {
        this.startChatSession((err, data) => {
            if (err) {
                callback(err);
            }
            else {
                callback(null);
                this.chatLink = data.chatLink;
                this.chatPolling();
            }
        });
    }

    startChatSession(callback) {
        console.log(`(startChatSession) In linkForNextChat: ${this.chatURL}`);

        const options = {
            method: 'POST',
            url: `${this.chatURL}.json?v=1&NC=true`,
            headers: {
                'Authorization': `Bearer ${this.session.getBearer()}`,
                'content-type': 'application/json',
                'Accept': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            json: true,
            body: {'chat': 'start'}
        };

        request(options, (error, response, body) => {
            if (error) {
                callback(`Failed to start chat session with error: ${JSON.stringify(error)}`);
            }
            else if(response.statusCode < 200 || response.statusCode > 299){
                callback(`Failed o start chat session with error: ${JSON.stringify(body)}`);
            }
            console.log(`Start chat session - body: ${body.chatLocation.link['@href']}`);
            callback(null, {
                chatLink: body.chatLocation.link['@href']
            });
        });
    }

    chatPolling(url) {
        if (!url) {
            url = this.chatLink + '.json?v=1&NC=true'
        }

        const options = {
            method: 'GET',
            url: url,
            headers: {
                'Authorization': `Bearer ${this.session.getBearer()}`,
                'content-type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            json:true
        };

        request(options, (error, response, body)=> {
            if (error) {
                console.error(`Agent polling failed. Error: ${JSON.stringify(error)}`);
                return;
            }
            else if(response.statusCode < 200 || response.statusCode > 299){
                console.error(`Agent polling failed. body: ${JSON.stringify(body)}`);
                return;
            }
            let events;
            let nextURL;

            if (body.chat && body.chat.error) {
                console.log(`Chat error: ${JSON.stringify(body.chat.error)}`);
                return;
            }

            if (body.chat && body.chat.events) {
                nextURL = `${getNextPingURL(body.chat.events.link)}&v=1&NC=true`;
                events = body.chat['events']['event'];
            }
            else {
                try {
                    nextURL = `${getNextPingURL(body.events.link)}&v=1&NC=true`;
                }
                catch (e) {
                    console.log(`Error getting the next URL link: ${e.message}, body=${JSON.stringify(body)}`);
                    return;
                }
                events = body['events']['event'];
            }

            if (events) {
                if (!Array.isArray(events)) { // The API send an object and not an array if there is 1 event only
                    events = [events];
                }
                for (let i = 0; i < events.length; i++) {
                    const ev = events[i];

                    if ((ev['@type'] === 'state') && (ev.state === 'ended')) {
                        return;
                    }
                    else if ((ev['@type'] === 'line') && (ev['source'] === 'visitor')) {
                        console.log(`(chatPolling) - line form visitor:${ev.text}`);

                        this.sendLine(ev.text);
                    }
                }
            }
            this.chatTimer = setTimeout(() => {
                this.chatPolling(nextURL);
            }, this.chatPingInterval);
        });
    }



    sendLine(inputText) {
        const line = inputText

        if (!line) {
            this.stop(err => {
                if (err) {
                    console.log(`Error stopping chat err: ${err.message}`);
                }
            });
            return;
        }

        let waOptions = {
           uri: `https://chat-broker.herokuapp.com/message/${line}`,

            headers: {
                'User-Agent': 'Request-Promise'
            },
            json: true // Automatically parses the JSON string in the response
        };

        let lpoptions = {
            method: 'POST',
            url: `${this.chatLink}/events.json?v=1&NC=true`,
            headers: {
                'Authorization': `Bearer ${this.session.getBearer()}`,
                'content-type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            json: true,

        };
        const lpresponse={}

        rp(waOptions)
            .then(function (waResponse) {
                if(waResponse.includes("<li>"))
                {
                    const liTagValues = fetchLITagValues(waResponse)
                    lpresponse.structuredContent=textToStructuredContent(liTagValues)
                }

                lpresponse.plainText=truncateAfter(waResponse,"<ol>")


                console.log(`Sending line: ${lpresponse.plainText}`);

                const plainTextOptions= Object.assign({},lpoptions,{body : {
                    event: {
                        '@type': 'line',
                        'text': `<p dir='ltr' style='direction: ltr; text-align: left;'>${lpresponse.plainText}</p>`,
                        'textType': 'html'
                    }
                }})


                rp(plainTextOptions)
                    .then(function (lpResponse) {
                        if(lpresponse.structuredContent) {
                            const structuredContentOptions= Object.assign({},lpoptions,{body : {
                                event: {
                                    '@type': 'line',
                                    'json' : lpresponse.structuredContent,
                                    'textType': 'rich-content'
                                }
                            }})

                            rp(structuredContentOptions)
                            .then(function (lpResponse) {

                            }).catch(function (err) {
                                 console.log(err.body)
                            });
                        }

                }).catch(function (err) {
                    console.log(err.body)
                });


        })
        .catch(function (err) {
            console.log(err.body)
        });






 /*       console.log(`Sending line: ${line}`);


        setTimeout(() => {
            request(options, (error, response, body) => {
                this.lineIndex++;
                if (error) {
                    console.log(`Error sending line. Error: ${JSON.stringify(error)}`);
                }
                else if(response.statusCode < 200 || response.statusCode > 299){
                    console.log(`Error sending line. Body: ${JSON.stringify(body)}`);

                }
                console.log(`Send line: ${JSON.stringify(body)}`);
            });
        }, config.chat.minLineWaitTime);*/
    }

    stop(callback) {
        clearTimeout(this.chatTimer);
        clearTimeout(this.incomingTimer);

        if (this.chatLink) {
            const options = {
                method: 'POST',
                url: `${this.chatLink}/events.json?v=1&NC=true`,
                headers: {
                    'Authorization': `Bearer ${this.session.getBearer()}`,
                    'content-type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                json: true,
                body: {
                    event: {
                        '@type': 'state',
                        'state': 'ended'
                    }
                }
            };
            request(options, (error, response, body) => {
                if (error) {
                    callback(`Error trying to end chat: ${JSON.stringify(error)}`);
                }
                else if(response.statusCode < 200 || response.statusCode > 299){
                    callback(`Error trying to end chat: ${JSON.stringify(body)}`);
                }
                this.session.stop(err => {
                    if (err) {
                        console.log(`Error stopping session: ${err.message}`);
                        callback(err);
                    }
                    else {
                       callback();
                    }
                });
            });
        }else{
            callback(`Chat link is unavailable chatLink: ${this.chatLink}`);
        }
    }

}

module.exports = AgentChat;
