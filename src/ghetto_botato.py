# ghetto_botato.py

import argparse
import datetime
import json
import re
import socket
import sys
import time

class Bot:
    MAX_SEND_RATE_USER = (20/30) # messages per second
    MAX_SEND_RATE_MOD = (100/30) # messages per second
    PRIVMSG_MESSAGE_REGEX = re.compile(r"^:\w+!\w+@\w+\.tmi\.twitch\.tv PRIVMSG #\w+ :")
    DEFAULT_COMMAND_TIMEOUT_SECONDS = 5
    
    def __init__(self, configuration):
        self.configuration = configuration
        self.commandsByTimeLastUsed = dict()

    def chat(self, sock, message):
        """
        Send a chat message to the server.
        """
        msg = "PRIVMSG #{} :{}".format(self.configuration["channel"], message)
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
        if (username == self.configuration["username"]):
            return ""

        words = message.split()
        commandStr = words[0]
        predicate = message[(len(command) + 1):]
        print("Parsed command: " + command)
        print("Parsed predicate: " predicate)

        command = getCommand(commandStr)

        if (command == "!echo"):
            return predicate
        
        if (command == "!foo"):
            return "bar"

        # if (command == )
        
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
        sock = Bot.joinChannel(self.configuration["host"], self.configuration["port"], self.configuration["channel"], self.configuration["username"], self.configuration["token"])

        while True:
            response = sock.recv(2040).decode("utf-8")
            self.handleResponse(sock, response)
            sendRate = (1 / Bot.MAX_SEND_RATE_USER)
            time.sleep(sendRate)

argParser = argparse.ArgumentParser()
argParser.add_argument('--config')
args = argParser.parse_args()
print(args.config)
configPath = args.config or "..\config\config.json"
print("Using configuration file at: " + configPath)

with open(configPath) as configurationFile:
    config = json.load(configurationFile)
print("Configuration loaded.")
print(config)

bot = Bot(config)
bot.startup()