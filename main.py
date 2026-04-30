import os, time, random, subprocess
import anotherSlotMachine as SMachine
import gamblingShop as GShop

DEBUG = False

def register():
    registerCredits = 10
    print(f'''  
    Gambling.com
    -Register-
''')
    username = input("Please choose a username: ")
    password = input("Please make a password: ")
    encodingPassword = ""
    with open(os.path.join(os.path.dirname(__file__), "CaesarShiftFile.txt"), "r") as f:
        encodes = f.read()
    
    for i in password:
        encodingPassword = int(f"{encodingPassword}{ord(i)}") 


    multiplyEncode = int(encodes[0:1])
    addEncode = int(encodes[1:2])

    encodingPassword = encodingPassword + addEncode
    encodingPassword = encodingPassword * multiplyEncode

    with open(os.path.join(os.path.dirname(__file__), "userData.txt"), "a+") as s:
        s.write(f"{username}:{encodingPassword}:{registerCredits}-")
        

def login():
    print('''
    Gambling.com
    -Login-
''')
    username = input("Name: ")
    password = input("Password: ")

    with open(os.path.join(os.path.dirname(__file__), "userData.txt"), "r") as p:
        userData = p.read()

    userData = userData.split("-")
    currentLoginData = ""
    for k in userData:
        currentData = k.split(":")
        for _ in currentData:
            if f"{username}" == _:
                currentLoginData = k
                currentLoginData = currentLoginData.split(":")
                usernameLogin = currentLoginData[0]
                unshiftedPasswordLogin = int(currentLoginData[1])
                loginCredits = float(currentLoginData[2])
                if DEBUG:
                    print(f"Unshifted Password: {unshiftedPasswordLogin}")
            else:
                continue
    
    if currentLoginData == "":
        print(f"Username {username} not associated with a valid account")
        registerQuestion = input("Would you like to create an account? (y/n): ").lower()
        if registerQuestion == "y":
            subprocess.run('cls', shell=True)
            register()
            subprocess.run('cls', shell=True)
            login()

        else:
            print("Alright, thanks for visiting Gambling.com!")
            exit()


    with open(os.path.join(os.path.dirname(__file__), "CaesarShiftFile.txt"), "r") as q:
        unshift = q.read()

    if DEBUG:
        print(unshift)

    multiplyUnshift = int(unshift[0:1])
    addUnshift = int(unshift[1:2])

    ## When we shift the password the first time, we add first then multiply, therefore when unshifting we divide first then subtract
    ASCIIPassword = ""
    for i in password:
        ASCIIPassword = int(f"{ASCIIPassword}{ord(i)}")
    if DEBUG:
        print(f"The inputted ASCII password: {ASCIIPassword}")

    # ASCII password is the inputted password that we turned to ASCII and we'll compare to the unshifted database password

    dividedPassword = unshiftedPasswordLogin // multiplyUnshift
    decryptedPassword = dividedPassword - addUnshift

    if decryptedPassword == ASCIIPassword:
        print(f"Welcome {usernameLogin}, you have {loginCredits} credits!")
        with open(os.path.join(os.path.dirname(__file__), "global.txt"), "w") as f:
            f.write(usernameLogin)
        # This is where a successful login would lead to the next part of the program
        newCredits = SMachine.slotMachine(loginCredits)
        updateCredits(usernameLogin, newCredits)
        '''keepPlaying = True
        while keepPlaying:
            subprocess.run('cls', shell=True)
            newCredits = SMachine.slotMachine(loginCredits)
            updateCredits(usernameLogin, newCredits)
            if DEBUG:
                print("<<< Credits Updated >>>")
                print(newCredits)
            askKeepPlaying = input("Would you like to keep playing? (y/n): ").lower()
            if askKeepPlaying == "y":
                loginCredits = newCredits
                continue
            else:
                keepPlaying = False
                print("Thanks for playing at Gambling.com!")
                time.sleep(2)
                subprocess.run('cls', shell=True)
                updateCredits(usernameLogin, newCredits)'''
        
            # Make a credits update function here to update the credits in the userData.txt file

    else:
        print("Your username is correct but your password is wrong")


def updateCredits(username, newCredits):
    with open(os.path.join(os.path.dirname(__file__), "userData.txt"), "r") as f:
        allUserData = f.read()
    
    userDataList = allUserData.split("-")
    updatedUserDataList = []
    for entry in userDataList:
        if username in entry:
            entryParts = entry.split(":")
            entryParts[2] = str(newCredits)
            updatedEntry = ":".join(entryParts)
            updatedUserDataList.append(updatedEntry)
        else:
            updatedUserDataList.append(entry)
    
    updatedAllUserData = "-".join(updatedUserDataList)
    with open("UserData.txt", "w") as f:
        f.write(updatedAllUserData)

subprocess.run('cls', shell=True)
print('''
    -Gambling.com-
''')
print("Welcome loyal gambler.")
account = input("Do you have an account? (y/n): ").lower().strip()
if account == "y":
    subprocess.run('cls', shell=True)
    login()
elif account == "n":
    registerQuestion = input("Would you like to create an account? (y/n): ").lower()
    if registerQuestion == "y":
        subprocess.run('cls', shell=True)
        register()
        subprocess.run('cls', shell=True)
        print("Account created successfully! Please log in now to verify your details.")
        login()
    else:
        print("Alright, thanks for visiting Gambling.com!")
        exit()


###--- TO DO ---###
