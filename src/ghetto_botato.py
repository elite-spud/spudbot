# ghetto_botato.py

import cfg
import socket
import time
import re

class Bot:
    MAX_SEND_RATE_USER = (20/30) # messages per second
    MAX_SEND_RATE_MOD = (100/30) # messages per second
    PRIVMSG_MESSAGE_REGEX = re.compile(r"^:\w+!\w+@\w+\.tmi\.twitch\.tv PRIVMSG #\w+ :")
    
    def __init__(self, configuration):
        self.configuration = configuration

    def chat(self, sock, message):
        """
        Send a chat message to the server.
        """
        msg = "PRIVMSG #{} :{}".format(self.configuration.CHANNEL, message)
        if (msg[-2:] != "\r\n"):
            msg += "\r\n"
        sock.send(msg.encode("utf-8"))

    def ban(self, sock, user):
        """
        Ban a user from the current channel
        """
        self.chat(sock, ".ban {}".format(user))

    def timeout(self, sock, user, durationSeconds=600):
        """
        Timeout a user for a set period of timeout
        """
        self, chat(sock, ".timeout {}".format(user, durationSeconds))

    def joinChannel(host, port, channel, nick, _pass):
        sock = socket.socket()
        sock.connect((host, port))
        sock.send("PASS {}\r\n".format(_pass).encode("utf-8"))
        sock.send("NICK {}\r\n".format(nick).encode("utf-8"))
        sock.send("JOIN #{}\r\n".format(channel).encode("utf-8"))
        return sock
        
    def getChatResponse(self, username, message):
        if (username == self.configuration.USERNAME):
            return ""

        if (message[:6] == "!echo "):
            return message[6:]
        
        if (message[:5] == "!foo "):
            return "bar"
        
        return ""

    def handleResponse(self, sock, response):        
        if (response == "PING :tmi.twitch.tv\r\n"):
            sock.send("PONG :tmi.twitch.tv\r\n".encode("utf-8"))
            return
        
        if (response.find("PRIVMSG") != -1):
            usernameRegex = r"\w+"
            username = re.search(usernameRegex, response).group(0) # return the entire match
            message = Bot.PRIVMSG_MESSAGE_REGEX.sub("", response)
            print(username)
            messageLog = "  " + message.replace("\n", "\n  ").rstrip()
            print(messageLog.encode("utf-8"))
            
            chatResponse = self.getChatResponse(username, message)
            if (chatResponse != ""):
                print("Response: " + chatResponse)
                self.chat(sock, chatResponse)
            return
        
        print(response)

    def startup(self):
        sock = Bot.joinChannel(self.configuration.HOST, self.configuration.PORT, self.configuration.CHANNEL, self.configuration.USERNAME, self.configuration.TOKEN)

        while True:
            response = sock.recv(2040).decode("utf-8")
            self.handleResponse(sock, response)
            sendRate = (1 / Bot.MAX_SEND_RATE_USER)
            time.sleep(sendRate)

bot = Bot(cfg)
bot.startup()